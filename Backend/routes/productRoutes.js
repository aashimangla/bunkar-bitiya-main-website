const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/products — public catalog listing (optionally filter by category)
router.get('/', (req, res) => {
  const db = getDb();
  const { category } = req.query;
  let products = db.products.filter(p => p.isActive !== false);
  if (category) {
    const catLower = category.toLowerCase();
    products = products.filter(p => p.category.toLowerCase() === catLower);
  }
  res.json(products);
});

// GET /api/products/:id — single product detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const product = db.products.find(p => p.id === req.params.id);
  if (!product || product.isActive === false) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(product);
});

module.exports = router;
