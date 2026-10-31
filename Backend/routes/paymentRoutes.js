const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { generateId } = require('../auth');
const { getDb, withDb } = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');
const { getRazorpay } = require('../config/razorpay');

function getEstimatedDelivery() {
  const d = new Date();
  d.setDate(d.getDate() + 5 + Math.floor(Math.random() * 3));
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Validates and normalizes cart items, and computes subtotal/shipping/total server-side.
// Never trust a total sent from the client — it's recomputed here from item prices.
function buildOrderTotals(items) {
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
  return { validItems, subtotal, shipping, total };
}

/* ═══════════════════════════════════════════════════════════════
   POST /api/payments/create-order
   Step 1 of online checkout: validate the cart, create a "pending"
   order in our DB, then create a matching order on Razorpay's side.
   The frontend uses the returned razorpayOrderId to open Razorpay
   Checkout.
   ═══════════════════════════════════════════════════════════════ */
router.post('/create-order', requireAuth, async (req, res) => {
  const { items, addressId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item' });
  }
  if (!addressId) {
    return res.status(400).json({ error: 'Delivery address is required' });
  }

  let localOrder, address;
  try {
    const result = withDb(db => {
      const addr = db.addresses.find(a => a.id === addressId && a.userId === req.user.userId);
      if (!addr) throw { status: 404, message: 'Delivery address not found' };

      const { validItems, subtotal, shipping, total } = buildOrderTotals(items);

      const newOrder = {
        id: generateId(),
        orderNumber: 'KLK-' + Date.now().toString().slice(-8),
        userId: req.user.userId,
        items: validItems,
        address: {
          name: addr.name, phone: addr.phone, line1: addr.line1,
          line2: addr.line2, city: addr.city, state: addr.state, pincode: addr.pincode
        },
        subtotal,
        shipping,
        total,
        paymentMethod: 'razorpay',
        paymentStatus: 'pending',
        razorpayOrderId: null,
        razorpayPaymentId: null,
        status: 'pending_payment',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.orders.push(newOrder);
      return { order: newOrder, address: addr };
    });
    localOrder = result.order;
    address = result.address;
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[payments/create-order] db error', e);
    return res.status(500).json({ error: 'Server error' });
  }

  // Now create the matching order on Razorpay's side.
  try {
    const razorpay = getRazorpay();
    const rpOrder = await razorpay.orders.create({
      amount: Math.round(localOrder.total * 100), // Razorpay expects paise
      currency: 'INR',
      receipt: localOrder.orderNumber,
      notes: { kalakarOrderId: localOrder.id, userId: req.user.userId }
    });

    withDb(db => {
      const o = db.orders.find(o => o.id === localOrder.id);
      if (o) { o.razorpayOrderId = rpOrder.id; o.updatedAt = new Date().toISOString(); }
    });

    const db = getDb();
    const user = db.users.find(u => u.id === req.user.userId);

    res.status(201).json({
      orderId: localOrder.id,
      orderNumber: localOrder.orderNumber,
      amount: rpOrder.amount,     // in paise, ready to hand to Razorpay Checkout
      currency: rpOrder.currency,
      razorpayOrderId: rpOrder.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      prefill: {
        name: user ? user.name : '',
        email: user ? user.email : '',
        contact: address.phone || ''
      }
    });
  } catch (e) {
    // Razorpay order creation failed — mark our pending order as failed so it
    // doesn't linger, rather than leaving an orphaned "pending_payment" order.
    withDb(db => {
      const o = db.orders.find(o => o.id === localOrder.id);
      if (o) { o.paymentStatus = 'failed'; o.updatedAt = new Date().toISOString(); }
    });
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[payments/create-order] razorpay error', e);
    res.status(502).json({ error: 'Could not initiate payment with Razorpay. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/payments/verify
   Step 2: called by the frontend from Razorpay Checkout's success
   handler. Verifies the payment signature server-side before ever
   trusting that the order is paid.
   ═══════════════════════════════════════════════════════════════ */
router.post('/verify', requireAuth, (req, res) => {
  const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!orderId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields' });
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return res.status(500).json({ error: 'Razorpay is not configured on the server' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');
  const isValid = expectedSignature === razorpay_signature;

  try {
    const order = withDb(db => {
      const o = db.orders.find(o => o.id === orderId && o.userId === req.user.userId);
      if (!o) throw { status: 404, message: 'Order not found' };
      if (o.razorpayOrderId !== razorpay_order_id) {
        throw { status: 400, message: 'This payment does not match this order' };
      }

      if (isValid) {
        o.paymentStatus = 'paid';
        o.status = 'confirmed';
        o.razorpayPaymentId = razorpay_payment_id;
      } else {
        o.paymentStatus = 'failed';
      }
      o.updatedAt = new Date().toISOString();
      return o;
    });

    if (!isValid) {
      return res.status(400).json({ error: 'Payment verification failed. Please try again or contact support.' });
    }

    res.json({
      message: 'Payment verified, order confirmed!',
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
    console.error('[payments/verify]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/payments/webhook
   Safety net for server-to-server events from Razorpay (e.g. if the
   customer closes the tab right after paying, before /verify runs).
   NOTE: mounted with express.raw() in server.js so req.body here is
   a raw Buffer, required for signature verification.
   ═══════════════════════════════════════════════════════════════ */
router.post('/webhook', (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn('[payments/webhook] RAZORPAY_WEBHOOK_SECRET not set — ignoring webhook call');
    return res.status(200).json({ received: true }); // ack so Razorpay doesn't keep retrying
  }

  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.body; // Buffer, thanks to express.raw() in server.js

  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  if (signature !== expected) {
    console.warn('[payments/webhook] invalid signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const event = payload.event;
  const paymentEntity = payload.payload && payload.payload.payment && payload.payload.payment.entity;

  if (paymentEntity && (event === 'payment.captured' || event === 'payment.failed')) {
    withDb(db => {
      const o = db.orders.find(o => o.razorpayOrderId === paymentEntity.order_id);
      if (!o) return;
      if (o.paymentStatus === 'paid' || o.paymentStatus === 'refunded') return; // already settled, don't reprocess

      if (event === 'payment.captured') {
        o.paymentStatus = 'paid';
        o.status = 'confirmed';
        o.razorpayPaymentId = paymentEntity.id;
      } else {
        o.paymentStatus = 'failed';
      }
      o.updatedAt = new Date().toISOString();
    });
  }

  res.json({ received: true });
});

module.exports = router;
