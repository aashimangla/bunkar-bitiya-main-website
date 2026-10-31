const express = require('express');
const router = express.Router();
const { generateId } = require('../auth');
const { getDb, withDb } = require('../db');
const { requireAdmin } = require('../middleware/authMiddleware');
const { getRazorpay } = require('../config/razorpay');

// Every route below requires a valid admin token
router.use(requireAdmin);

const VALID_STATUSES = ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

/* ═══════════════════════ DASHBOARD STATS ═══════════════════════ */

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const db = getDb();
  const totalRevenue = db.orders
    .filter(o => o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.total, 0);

  const statusCounts = db.orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {});

  const recentOrders = db.orders
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5)
    .map(o => {
      const user = db.users.find(u => u.id === o.userId);
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: user ? user.name : 'Unknown',
        total: o.total,
        status: o.status,
        createdAt: o.createdAt
      };
    });

  res.json({
    totalUsers: db.users.length,
    totalProducts: db.products.length,
    totalOrders: db.orders.length,
    totalRevenue,
    statusCounts,
    recentOrders
  });
});

/* ═══════════════════════ ORDERS ═══════════════════════ */

// GET /api/admin/orders — list all orders (optionally filter by status, search by order#/email)
router.get('/orders', (req, res) => {
  const db = getDb();
  const { status, q } = req.query;

  let orders = db.orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (status) orders = orders.filter(o => o.status === status);

  let result = orders.map(o => {
    const user = db.users.find(u => u.id === o.userId);
    return {
      ...o,
      customerName: user ? user.name : 'Unknown',
      customerEmail: user ? user.email : ''
    };
  });

  if (q) {
    const qLower = q.toLowerCase();
    result = result.filter(o =>
      o.orderNumber.toLowerCase().includes(qLower) ||
      o.customerEmail.toLowerCase().includes(qLower) ||
      o.customerName.toLowerCase().includes(qLower)
    );
  }

  res.json(result);
});

// GET /api/admin/orders/:id
router.get('/orders/:id', (req, res) => {
  const db = getDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const user = db.users.find(u => u.id === order.userId);
  res.json({ ...order, customerName: user ? user.name : 'Unknown', customerEmail: user ? user.email : '' });
});

// PUT /api/admin/orders/:id/status
router.put('/orders/:id/status', (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be one of: ' + VALID_STATUSES.join(', ') });
  }
  try {
    const order = withDb(db => {
      const o = db.orders.find(o => o.id === req.params.id);
      if (!o) throw { status: 404, message: 'Order not found' };
      o.status = status;
      o.updatedAt = new Date().toISOString();
      return o;
    });
    res.json(order);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/orders/:id/refund — refund a Razorpay-paid order (full or partial)
router.post('/orders/:id/refund', async (req, res) => {
  const { amount, notes } = req.body; // amount in rupees, optional — omit for a full refund

  const db = getDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.paymentMethod !== 'razorpay') {
    return res.status(400).json({ error: 'Only online (Razorpay) payments can be refunded here. Cash on Delivery orders have nothing to refund.' });
  }
  if (order.paymentStatus !== 'paid') {
    return res.status(400).json({ error: `This order's payment status is "${order.paymentStatus}" — only paid orders can be refunded.` });
  }
  if (!order.razorpayPaymentId) {
    return res.status(400).json({ error: 'No Razorpay payment ID is recorded on this order' });
  }
  if (amount !== undefined && !(Number(amount) > 0)) {
    return res.status(400).json({ error: 'Refund amount must be a positive number' });
  }

  try {
    const razorpay = getRazorpay();
    const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
      amount: amount !== undefined ? Math.round(Number(amount) * 100) : undefined, // paise; omit = full refund
      notes: notes ? { reason: String(notes).slice(0, 500) } : undefined
    });

    const isFullRefund = !amount || Number(amount) >= order.total;
    const updated = withDb(db => {
      const o = db.orders.find(o => o.id === req.params.id);
      o.paymentStatus = isFullRefund ? 'refunded' : 'partially_refunded';
      if (isFullRefund) o.status = 'cancelled';
      o.updatedAt = new Date().toISOString();
      return o;
    });

    res.json({ message: 'Refund processed', refundId: refund.id, order: updated });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[admin/orders/refund]', e);
    res.status(502).json({ error: e.error && e.error.description ? e.error.description : 'Refund failed. Please check the Razorpay dashboard.' });
  }
});

/* ═══════════════════════ SELLER APPLICATIONS ═══════════════════════ */

// GET /api/admin/seller-applications
// Admin can view all seller applications or filter by status.
router.get('/seller-applications', (req, res) => {
  const db = getDb();
  const { status } = req.query;

  let applications = db.users
    .filter(user => user.sellerApplication)
    .map(user => ({
      userId: user.id,
      name: user.name,
      email: user.email,
      sellerStatus: user.sellerStatus || 'pending',
      ...user.sellerApplication
    }))
    .sort((a, b) =>
      new Date(b.submittedAt) - new Date(a.submittedAt)
    );

  if (status) {
    applications = applications.filter(
      application => application.status === status
    );
  }

  res.json(applications);
});

// PUT /api/admin/seller-applications/:userId
// Admin approves or rejects a seller application.
router.put('/seller-applications/:userId', (req, res) => {
  const { status, reviewNote } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({
      error: 'Status must be approved or rejected.'
    });
  }

  try {
    const result = withDb(db => {
      const user = db.users.find(
        u => u.id === req.params.userId
      );

      if (!user || !user.sellerApplication) {
        throw {
          status: 404,
          message: 'Seller application not found.'
        };
      }

      if (user.sellerStatus !== 'pending') {
        throw {
          status: 409,
          message: 'This application has already been reviewed.'
        };
      }

      user.sellerStatus = status;
      user.sellerApplication.status = status;
      user.sellerApplication.reviewedAt = new Date().toISOString();
      user.sellerApplication.reviewedBy = req.user.userId;
      user.sellerApplication.reviewNote =
        String(reviewNote || '').trim().slice(0, 500);

      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        sellerStatus: user.sellerStatus,
        application: user.sellerApplication
      };
    });

    res.json({
      message: `Seller application ${status}.`,
      ...result
    });
  } catch (e) {
    if (e.status) {
      return res.status(e.status).json({ error: e.message });
    }

    console.error('[Seller approval]', e);
    res.status(500).json({
      error: 'Could not update seller application.'
    });
  }
});

/* ═══════════════════════ USERS ═══════════════════════ */

// GET /api/admin/users
router.get('/users', (req, res) => {
  const db = getDb();
  const users = db.users
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      isAdmin: !!u.isAdmin,
      isBlocked: !!u.isBlocked,
      createdAt: u.createdAt,
      orderCount: db.orders.filter(o => o.userId === u.id).length
    }));
  res.json(users);
});

// PUT /api/admin/users/:id — update role / blocked status / name
router.put('/users/:id', (req, res) => {
  const { isAdmin, isBlocked, name } = req.body;
  try {
    const result = withDb(db => {
      const u = db.users.find(u => u.id === req.params.id);
      if (!u) throw { status: 404, message: 'User not found' };
      if (u.id === req.user.userId && isAdmin === false) {
        throw { status: 400, message: "You can't remove your own admin access" };
      }
      if (typeof isAdmin === 'boolean') u.isAdmin = isAdmin;
      if (typeof isBlocked === 'boolean') u.isBlocked = isBlocked;
      if (name) u.name = name.trim();
      return u;
    });
    res.json({
      id: result.id, name: result.name, email: result.email,
      isAdmin: !!result.isAdmin, isBlocked: !!result.isBlocked
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.userId) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }
  try {
    withDb(db => {
      const idx = db.users.findIndex(u => u.id === req.params.id);
      if (idx === -1) throw { status: 404, message: 'User not found' };
      db.users.splice(idx, 1);
    });
    res.json({ message: 'User deleted' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* ═══════════════════════ PRODUCTS ═══════════════════════ */

// GET /api/admin/products — includes inactive products, unlike the public endpoint
router.get('/products', (req, res) => {
  const db = getDb();
  res.json(db.products.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
});

// POST /api/admin/products
router.post('/products', (req, res) => {
  const { name, category, desc, price, oldPrice, img, sizes, stock, badge, isActive } = req.body;
  if (!name || !category || price === undefined) {
    return res.status(400).json({ error: 'Name, category and price are required' });
  }
  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    return res.status(400).json({ error: 'Price must be a positive number' });
  }
  if (oldPrice !== undefined && oldPrice !== null && oldPrice !== '' && !(Number(oldPrice) > 0)) {
    return res.status(400).json({ error: 'Old price must be a positive number' });
  }

  try {
    const product = withDb(db => {
      const p = {
        id: generateId(),
        name: name.trim(),
        category: category.trim(),
        desc: (desc || '').trim(),
        price: priceNum,
        oldPrice: (oldPrice !== undefined && oldPrice !== null && oldPrice !== '') ? Number(oldPrice) : null,
        img: (img || '').trim(),
        sizes: Array.isArray(sizes) ? sizes : (sizes ? String(sizes).split(',').map(s => s.trim()).filter(Boolean) : []),
        stock: Number.isFinite(Number(stock)) ? Number(stock) : 0,
        badge: badge || null,
        isActive: isActive !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.products.push(p);
      return p;
    });
    res.status(201).json(product);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/products/:id
router.put('/products/:id', (req, res) => {
  const { name, category, desc, price, oldPrice, img, sizes, stock, badge, isActive } = req.body;
  if (price !== undefined && !(Number(price) > 0)) {
    return res.status(400).json({ error: 'Price must be a positive number' });
  }
  try {
    const result = withDb(db => {
      const p = db.products.find(p => p.id === req.params.id);
      if (!p) throw { status: 404, message: 'Product not found' };
      if (name) p.name = name.trim();
      if (category) p.category = category.trim();
      if (desc !== undefined) p.desc = desc.trim();
      if (price !== undefined) p.price = Number(price);
      if (oldPrice !== undefined) p.oldPrice = (oldPrice === null || oldPrice === '') ? null : Number(oldPrice);
      if (img !== undefined) p.img = img.trim();
      if (sizes !== undefined) {
        p.sizes = Array.isArray(sizes) ? sizes : String(sizes).split(',').map(s => s.trim()).filter(Boolean);
      }
      if (stock !== undefined) p.stock = Number(stock);
      if (badge !== undefined) p.badge = badge || null;
      if (isActive !== undefined) p.isActive = isActive;
      p.updatedAt = new Date().toISOString();
      return p;
    });
    res.json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', (req, res) => {
  try {
    withDb(db => {
      const idx = db.products.findIndex(p => p.id === req.params.id);
      if (idx === -1) throw { status: 404, message: 'Product not found' };
      db.products.splice(idx, 1);
    });
    res.json({ message: 'Product deleted' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
