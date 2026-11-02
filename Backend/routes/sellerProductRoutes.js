
const express = require('express');
const router = express.Router();

const { generateId } = require('../auth');
const { getDb, withDb } = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

// All seller product routes require login.
router.use(requireAuth);

// Only approved, non-blocked sellers can manage products.
router.use((req, res, next) => {
  const db = getDb();

  const seller = db.users.find(
    u => u.id === req.user.userId
  );

  if (!seller || seller.isBlocked) {
    return res.status(403).json({
      error: 'Account unavailable.'
    });
  }

  if (seller.sellerStatus !== 'approved') {
    return res.status(403).json({
      error: 'Your seller account is not approved yet.'
    });
  }

  req.seller = seller;
  next();
});

// GET /api/seller/products
// Show only products belonging to the logged-in seller.
router.get('/', (req, res) => {
  const db = getDb();

  const products = db.products
    .filter(p => p.sellerId === req.user.userId)
    .sort((a, b) =>
      new Date(b.createdAt || 0) -
      new Date(a.createdAt || 0)
    );

  res.json(products);
});

// POST /api/seller/products
// Add a new product.
router.post('/', (req, res) => {
  const {
    name, category, desc, price,
    oldPrice, img, sizes, stock
  } = req.body;

  if (!name || !category || price === undefined) {
    return res.status(400).json({
      error: 'Name, category and price are required.'
    });
  }

  const priceNum = Number(price);

  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    return res.status(400).json({
      error: 'Price must be a positive number.'
    });
  }

  if (
    oldPrice !== undefined &&
    oldPrice !== null &&
    oldPrice !== '' &&
    (!Number.isFinite(Number(oldPrice)) || Number(oldPrice) <= 0)
  ) {
    return res.status(400).json({
      error: 'Old price must be a positive number.'
    });
  }

  const stockNum = stock === undefined ? 0 : Number(stock);

  if (!Number.isInteger(stockNum) || stockNum < 0) {
    return res.status(400).json({
      error: 'Stock must be a non-negative whole number.'
    });
  }

  try {
    const product = withDb(db => {
      const now = new Date().toISOString();

      const newProduct = {
        id: generateId(),
        sellerId: req.user.userId,
        name: String(name).trim(),
        category: String(category).trim(),
        desc: String(desc || '').trim(),
        price: priceNum,
        oldPrice:
          oldPrice !== undefined && oldPrice !== null && oldPrice !== ''
            ? Number(oldPrice)
            : null,
        img: String(img || '').trim(),
        sizes: Array.isArray(sizes)
          ? sizes
          : sizes
            ? String(sizes).split(',').map(s => s.trim()).filter(Boolean)
            : [],
        stock: stockNum,
        badge: null,
        isActive: true,
        createdAt: now,
        updatedAt: now
      };

      db.products.push(newProduct);
      return newProduct;
    });

    res.status(201).json({
      message: 'Product added successfully.',
      product
    });
  } catch (error) {
    console.error('[Seller add product]', error);
    res.status(500).json({ error: 'Could not add product.' });
  }
});

// PUT /api/seller/products/:id
// Edit only the seller's own product.
router.put('/:id', (req, res) => {
  const {
    name, category, desc, price,
    oldPrice, img, sizes, stock
  } = req.body;

  if (
    price !== undefined &&
    (!Number.isFinite(Number(price)) || Number(price) <= 0)
  ) {
    return res.status(400).json({
      error: 'Price must be a positive number.'
    });
  }

  if (
    stock !== undefined &&
    (!Number.isInteger(Number(stock)) || Number(stock) < 0)
  ) {
    return res.status(400).json({
      error: 'Stock must be a non-negative whole number.'
    });
  }

  if (
    oldPrice !== undefined &&
    oldPrice !== null &&
    oldPrice !== '' &&
    (!Number.isFinite(Number(oldPrice)) || Number(oldPrice) <= 0)
  ) {
    return res.status(400).json({
      error: 'Old price must be a positive number.'
    });
  }

  try {
    const product = withDb(db => {
      const p = db.products.find(
        item =>
          item.id === req.params.id &&
          item.sellerId === req.user.userId
      );

      if (!p) {
        throw {
          status: 404,
          message: 'Product not found or access denied.'
        };
      }

      if (name !== undefined) p.name = String(name).trim();
      if (category !== undefined) p.category = String(category).trim();
      if (desc !== undefined) p.desc = String(desc).trim();
      if (price !== undefined) p.price = Number(price);

      if (oldPrice !== undefined) {
        p.oldPrice =
          oldPrice === null || oldPrice === ''
            ? null
            : Number(oldPrice);
      }

      if (img !== undefined) p.img = String(img).trim();

      if (sizes !== undefined) {
        p.sizes = Array.isArray(sizes)
          ? sizes
          : String(sizes).split(',').map(s => s.trim()).filter(Boolean);
      }

      if (stock !== undefined) p.stock = Number(stock);

      p.updatedAt = new Date().toISOString();

      return p;
    });

    res.json({
      message: 'Product updated successfully.',
      product
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error('[Seller update product]', error);
    res.status(500).json({ error: 'Could not update product.' });
  }
});

// DELETE /api/seller/products/:id
// Delete only the seller's own product.
router.delete('/:id', (req, res) => {
  try {
    withDb(db => {
      const index = db.products.findIndex(
        p =>
          p.id === req.params.id &&
          p.sellerId === req.user.userId
      );

      if (index === -1) {
        throw {
          status: 404,
          message: 'Product not found or access denied.'
        };
      }

      db.products.splice(index, 1);
    });

    res.json({ message: 'Product deleted successfully.' });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error('[Seller delete product]', error);
    res.status(500).json({ error: 'Could not delete product.' });
  }
});

module.exports = router;
