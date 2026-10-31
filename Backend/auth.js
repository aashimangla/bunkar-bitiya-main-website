/**
 * Auth utilities using ONLY Node.js built-in crypto
 * No bcryptjs, no jsonwebtoken package needed
 */
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'kalakar_secret_himalayan_2025_xK9mP3q';
const TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

/* ── Password hashing ── */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const testHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return testHash === hash;
}

/* ── Minimal JWT (HS256) ── */

function base64urlEncode(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

function signToken(payload) {
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify({
    ...payload,
    iat: Date.now(),
    exp: Date.now() + TOKEN_EXPIRY
  }));
  const sig = crypto.createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(base64urlDecode(body));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

/* ── OTP (email verification) ── */

// 6-digit numeric OTP, generated with crypto for unpredictability
function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

// OTPs are hashed before being stored, same idea as passwords — so a leaked
// DB file doesn't hand out valid codes directly.
function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function verifyOtp(otp, hash) {
  if (!otp || !hash) return false;
  const a = Buffer.from(hashOtp(otp));
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  hashPassword, verifyPassword, signToken, verifyToken, generateId,
  generateOtp, hashOtp, verifyOtp
};
