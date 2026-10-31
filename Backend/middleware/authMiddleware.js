const { verifyToken } = require('../auth');
const { getDb } = require('../db');

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.headers['x-auth-token'];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = payload;
  next();
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.headers['x-auth-token'];

  if (token) {
    const payload = verifyToken(token);
    if (payload) req.user = payload;
  }
  next();
}

// Requires a valid token AND that the user is currently marked isAdmin in the DB.
// We re-check the DB (rather than trusting the JWT payload) so that revoking
// admin access takes effect immediately, without waiting for the token to expire.
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.headers['x-auth-token'];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const db = getDb();
  const user = db.users.find(u => u.id === payload.userId);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (user.isBlocked) {
    return res.status(403).json({ error: 'This account has been blocked' });
  }

  req.user = payload;
  req.adminUser = user;
  next();
}

module.exports = { requireAuth, optionalAuth, requireAdmin };
