const express = require('express');
const router = express.Router();
const { generateId } = require('../auth');
const { getDb, withDb } = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');
const { getRazorpay } = require('../config/razorpay');

// Statuses a customer is still allowed to cancel from. Once an order has
// shipped we no longer let the customer self-cancel — they need support.
const CUSTOMER_CANCELLABLE_STATUSES = ['pending_payment', 'confirmed', 'processing'];

// POST /api/orders — place a Cash-on-Delivery order (online payments go through
// /api/payments/create-order + /api/payments/verify instead)
router.post('/', requireAuth, (req, res) => {
  const { items, addressId, paymentMethod } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item' });
  }
  if (!addressId) {
    return res.status(400).json({ error: 'Delivery address is required' });
  }
  if (paymentMethod !== 'cod') {
    return res.status(400).json({
      error: "This endpoint only accepts Cash on Delivery orders. For online payments, use /api/payments/create-order."
    });
  }

  try {
    const order = withDb(db => {
      const address = db.addresses.find(a => a.id === addressId && a.userId === req.user.userId);
      if (!address) throw { status: 404, message: 'Delivery address not found' };

      // Validate items and calculate total
      const validItems = items.map(item => {
        if (!item.id || !item.name || !item.price || !item.qty) {
          throw { status: 400, message: 'Invalid item in order' };
        }
        const price = Number(item.price);
        const qty = Number(item.qty);
        if (!Number.isFinite(price) || price <= 0) {
          throw { status: 400, message: 'Item price must be a positive number' };
        }
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
          throw { status: 400, message: 'Item quantity must be a positive integer' };
        }
        return {
          id: String(item.id).slice(0, 100),
          name: String(item.name).slice(0, 200),
          desc: String(item.desc || '').slice(0, 500),
          price,
          qty,
          img: String(item.img || '').slice(0, 500),
          selectedSize: item.selectedSize ? String(item.selectedSize).slice(0, 50) : null
        };
      });

      const subtotal = validItems.reduce((s, i) => s + i.price * i.qty, 0);
      const shipping = subtotal >= 999 ? 0 : 80;
      const total = subtotal + shipping;

      const newOrder = {
        id: generateId(),
        orderNumber: 'KLK-' + Date.now().toString().slice(-8),
        userId: req.user.userId,
        items: validItems,
        address: {
          name: address.name,
          phone: address.phone,
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          state: address.state,
          pincode: address.pincode
        },
        subtotal,
        shipping,
        total,
        paymentMethod,
        paymentStatus: 'pending', // COD is paid on delivery, not upfront
        status: 'confirmed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      db.orders.push(newOrder);
      return newOrder;
    });

    res.status(201).json({
      message: 'Order placed successfully!',
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        total: order.total,
        status: order.status,
        estimatedDelivery: getEstimatedDelivery()
      }
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/orders — get user's order history
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const orders = db.orders
    .filter(o => o.userId === req.user.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(o => ({
      id: o.id,
      orderNumber: o.orderNumber,
      items: o.items,
      address: o.address,
      subtotal: o.subtotal,
      shipping: o.shipping,
      total: o.total,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      status: o.status,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt
    }));
  res.json(orders);
});

// GET /api/orders/:id — get single order
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const order = db.orders.find(o => o.id === req.params.id && o.userId === req.user.userId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// PUT /api/orders/:id/cancel — customer-initiated cancellation.
// Only allowed while the order hasn't shipped yet. If it was already paid
// for online via Razorpay, this also issues a full refund before marking
// the order cancelled, so the customer never has to chase a refund manually.
router.put('/:id/cancel', requireAuth, async (req, res) => {
  const db = getDb();
  const order = db.orders.find(o => o.id === req.params.id && o.userId === req.user.userId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) {
    return res.status(400).json({
      error: order.status === 'cancelled'
        ? 'This order has already been cancelled.'
        : `This order is already "${order.status}" and can no longer be cancelled online. Please contact support.`
    });
  }

  // If it was paid online, refund it first — we only flip the order to
  // cancelled once the refund has actually gone through.
  if (order.paymentMethod === 'razorpay' && order.paymentStatus === 'paid' && order.razorpayPaymentId) {
    try {
      const razorpay = getRazorpay();
      await razorpay.payments.refund(order.razorpayPaymentId, {
        notes: { reason: 'Customer-initiated cancellation' }
      });
    } catch (e) {
      console.error('[orders/cancel] refund error', e);
      const msg = e.error && e.error.description ? e.error.description : 'Could not process the refund automatically. Please contact support to cancel this order.';
      return res.status(502).json({ error: msg });
    }
  }

  try {
    const updated = withDb(db => {
      const o = db.orders.find(o => o.id === req.params.id && o.userId === req.user.userId);
      if (!o) throw { status: 404, message: 'Order not found' };
      o.status = 'cancelled';
      if (o.paymentMethod === 'razorpay' && o.paymentStatus === 'paid') {
        o.paymentStatus = 'refunded';
      }
      o.updatedAt = new Date().toISOString();
      return o;
    });
    res.json({ message: 'Order cancelled successfully', order: updated });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[orders/cancel]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

function getEstimatedDelivery() {
  const d = new Date();
  d.setDate(d.getDate() + 5 + Math.floor(Math.random() * 3));
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

module.exports = router;
