const express = require('express');
const router = express.Router();
const { generateId } = require('../auth');
const { getDb, withDb } = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

// GET /api/addresses — get current user's addresses
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const addresses = db.addresses.filter(a => a.userId === req.user.userId);
  res.json(addresses);
});

// POST /api/addresses — add new address
router.post('/', requireAuth, (req, res) => {
  const { name, phone, line1, line2, city, state, pincode, isDefault } = req.body;
  if (!name || !phone || !line1 || !city || !state || !pincode) {
    return res.status(400).json({ error: 'Name, phone, address line 1, city, state and pincode are required' });
  }
  if (!/^\d{6}$/.test(pincode)) {
    return res.status(400).json({ error: 'Pincode must be 6 digits' });
  }
  if (!/^\d{10}$/.test(phone.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'Phone must be 10 digits' });
  }

  try {
    const address = withDb(db => {
      const userAddresses = db.addresses.filter(a => a.userId === req.user.userId);

      // If this is first address or marked as default, unset others
      if (isDefault || userAddresses.length === 0) {
        userAddresses.forEach(a => { a.isDefault = false; });
      }

      const addr = {
        id: generateId(),
        userId: req.user.userId,
        name: name.trim(),
        phone: phone.trim(),
        line1: line1.trim(),
        line2: (line2 || '').trim(),
        city: city.trim(),
        state: state.trim(),
        pincode: pincode.trim(),
        isDefault: isDefault || userAddresses.length === 0,
        createdAt: new Date().toISOString()
      };
      db.addresses.push(addr);
      return addr;
    });
    res.status(201).json(address);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/addresses/:id — update address
router.put('/:id', requireAuth, (req, res) => {
  const { name, phone, line1, line2, city, state, pincode, isDefault } = req.body;
  if (pincode && !/^\d{6}$/.test(pincode)) {
    return res.status(400).json({ error: 'Pincode must be 6 digits' });
  }
  if (phone && !/^\d{10}$/.test(phone.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'Phone must be 10 digits' });
  }
  try {
    const result = withDb(db => {
      const addr = db.addresses.find(a => a.id === req.params.id && a.userId === req.user.userId);
      if (!addr) throw { status: 404, message: 'Address not found' };

      if (isDefault) {
        db.addresses.filter(a => a.userId === req.user.userId).forEach(a => { a.isDefault = false; });
      }

      if (name) addr.name = name.trim();
      if (phone) addr.phone = phone.trim();
      if (line1) addr.line1 = line1.trim();
      if (line2 !== undefined) addr.line2 = line2.trim();
      if (city) addr.city = city.trim();
      if (state) addr.state = state.trim();
      if (pincode) addr.pincode = pincode.trim();
      if (isDefault !== undefined) addr.isDefault = isDefault;
      return addr;
    });
    res.json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/addresses/:id
router.delete('/:id', requireAuth, (req, res) => {
  try {
    withDb(db => {
      const idx = db.addresses.findIndex(a => a.id === req.params.id && a.userId === req.user.userId);
      if (idx === -1) throw { status: 404, message: 'Address not found' };
      db.addresses.splice(idx, 1);
    });
    res.json({ message: 'Address deleted' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/addresses/:id/default
router.put('/:id/default', requireAuth, (req, res) => {
  try {
    withDb(db => {
      const userAddresses = db.addresses.filter(a => a.userId === req.user.userId);
      const addr = userAddresses.find(a => a.id === req.params.id);
      if (!addr) throw { status: 404, message: 'Address not found' };
      userAddresses.forEach(a => { a.isDefault = a.id === req.params.id; });
    });
    res.json({ message: 'Default address updated' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
