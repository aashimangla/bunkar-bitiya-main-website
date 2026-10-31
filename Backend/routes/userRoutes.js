const express = require('express');
const router = express.Router();
const {
  hashPassword, verifyPassword, signToken, generateId,
  generateOtp, hashOtp, verifyOtp
} = require('../auth');
const { getDb, withDb } = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');
const { sendOtpEmail } = require('../mailer');

const OTP_TTL_MS = 10 * 60 * 1000;       // OTP valid for 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60s between resend requests
const OTP_MAX_ATTEMPTS = 5;               // wrong-guess lockout before a resend is required

function issueOtpFields() {
  const otp = generateOtp();
  return {
    otp, // returned only so the caller can email it — never persisted in plaintext
    otpHash: hashOtp(otp),
    otpExpires: Date.now() + OTP_TTL_MS,
    otpAttempts: 0,
    otpLastSentAt: Date.now()
  };
}

// POST /api/users/register
// Creates an (unverified) account and emails a 6-digit OTP. The account only
// becomes usable — and only then does the client receive a login token —
// after /verify-otp succeeds.
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const emailLower = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  try {
    const { user, otp } = withDb(db => {
      const existing = db.users.find(u => u.email === emailLower);

      if (existing && existing.isVerified !== false) {
        // Already a real, verified account
        throw { status: 409, message: 'An account with this email already exists' };
      }

      const { hash, salt } = hashPassword(password);
      const otpFields = issueOtpFields();

      if (existing) {
        // Previous signup attempt never got verified — overwrite with the
        // latest details and send a fresh code instead of creating a dupe.
        existing.name = name.trim();
        existing.passwordHash = hash;
        existing.salt = salt;
        existing.otpHash = otpFields.otpHash;
        existing.otpExpires = otpFields.otpExpires;
        existing.otpAttempts = 0;
        existing.otpLastSentAt = otpFields.otpLastSentAt;
        return { user: existing, otp: otpFields.otp };
      }

      const newUser = {
        id: generateId(),
        name: name.trim(),
        email: emailLower,
        passwordHash: hash,
        salt,
        isAdmin: false,
        isBlocked: false,
        isVerified: false,
        otpHash: otpFields.otpHash,
        otpExpires: otpFields.otpExpires,
        otpAttempts: 0,
        otpLastSentAt: otpFields.otpLastSentAt,
        createdAt: new Date().toISOString()
      };
      db.users.push(newUser);
      return { user: newUser, otp: otpFields.otp };
    });

    try {
      await sendOtpEmail({ to: user.email, name: user.name, otp });
    } catch (mailErr) {
      console.error('[OTP email] send failed:', mailErr.message);
      return res.status(502).json({ error: 'Could not send verification email. Please try again in a moment.' });
    }

    res.status(201).json({
      message: 'We emailed you a 6-digit verification code. Enter it to activate your account.',
      requiresVerification: true,
      email: user.email
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users/verify-otp
// Confirms the emailed code and, on success, activates the account and
// returns a login token — this is the only place a token is issued after signup.
router.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and verification code are required' });
  }
  const emailLower = email.toLowerCase().trim();

  try {
    const user = withDb(db => {
      const u = db.users.find(x => x.email === emailLower);
      if (!u) throw { status: 404, message: 'No pending signup found for this email' };
      if (u.isVerified) throw { status: 400, message: 'This account is already verified. Please sign in.' };

      if (!u.otpExpires || Date.now() > u.otpExpires) {
        throw { status: 400, message: 'This code has expired. Please request a new one.' };
      }
      if ((u.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
        throw { status: 429, message: 'Too many incorrect attempts. Please request a new code.' };
      }

      if (!verifyOtp(String(otp).trim(), u.otpHash)) {
        u.otpAttempts = (u.otpAttempts || 0) + 1;
        throw { status: 400, message: 'Incorrect verification code' };
      }

      u.isVerified = true;
      u.otpHash = null;
      u.otpExpires = null;
      u.otpAttempts = 0;
      return u;
    });

    const token = signToken({ userId: user.id, email: user.email, name: user.name });
    res.json({
      message: 'Email verified — account activated!',
      token,
      user: { id: user.id, name: user.name, email: user.email, isAdmin: !!user.isAdmin }
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users/resend-otp
router.post('/resend-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const emailLower = email.toLowerCase().trim();

  try {
    const { user, otp } = withDb(db => {
      const u = db.users.find(x => x.email === emailLower);
      if (!u) throw { status: 404, message: 'No pending signup found for this email' };
      if (u.isVerified) throw { status: 400, message: 'This account is already verified. Please sign in.' };

      if (u.otpLastSentAt && Date.now() - u.otpLastSentAt < OTP_RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - u.otpLastSentAt)) / 1000);
        throw { status: 429, message: `Please wait ${waitSec}s before requesting another code` };
      }

      const otpFields = issueOtpFields();
      u.otpHash = otpFields.otpHash;
      u.otpExpires = otpFields.otpExpires;
      u.otpAttempts = 0;
      u.otpLastSentAt = otpFields.otpLastSentAt;
      return { user: u, otp: otpFields.otp };
    });

    try {
      await sendOtpEmail({ to: user.email, name: user.name, otp });
    } catch (mailErr) {
      console.error('[OTP email] resend failed:', mailErr.message);
      return res.status(502).json({ error: 'Could not send verification email. Please try again in a moment.' });
    }

    res.json({ message: 'A new verification code has been sent to your email.' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const db = getDb();
  const user = db.users.find(u => u.email === email.toLowerCase().trim());
  if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.isBlocked) {
    return res.status(403).json({ error: 'This account has been blocked. Please contact support.' });
  }
  // isVerified === false only for accounts created after OTP verification shipped;
  // older accounts (isVerified undefined) are treated as already-trusted/grandfathered.
  if (user.isVerified === false) {
    return res.status(403).json({
      error: 'Please verify your email before signing in.',
      requiresVerification: true,
      email: user.email
    });
  }

  const token = signToken({ userId: user.id, email: user.email, name: user.name });
  res.json({
    message: 'Login successful',
    token,
    user: { id: user.id, name: user.name, email: user.email, isAdmin: !!user.isAdmin }
  });
});

// GET /api/users/me
router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, name: user.name, email: user.email, isAdmin: !!user.isAdmin, createdAt: user.createdAt });
});

// PUT /api/users/me
router.put('/me', requireAuth, (req, res) => {
  const { name } = req.body;
  try {
    const result = withDb(db => {
      const user = db.users.find(u => u.id === req.user.userId);
      if (!user) throw { status: 404, message: 'User not found' };
      if (name) user.name = name.trim();
      return user;
    });
    res.json({ id: result.id, name: result.name, email: result.email });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users/seller-application
// A logged-in customer can apply to become a seller.
router.post('/seller-application', requireAuth, (req, res) => {
  const { businessName, phone, category, description, address } = req.body;

  if (!businessName || !phone || !category || !description || !address) {
    return res.status(400).json({
      error: 'Please complete all seller application fields.'
    });
  }

  if (
    String(businessName).trim().length < 2 ||
    String(phone).trim().length < 10 ||
    String(category).trim().length < 2 ||
    String(description).trim().length < 20 ||
    String(address).trim().length < 5
  ) {
    return res.status(400).json({
      error: 'Please provide valid details. Description must be at least 20 characters.'
    });
  }

  try {
    const result = withDb(db => {
      const user = db.users.find(u => u.id === req.user.userId);

      if (!user) {
        throw { status: 404, message: 'User not found.' };
      }

      if (user.isAdmin) {
        throw { status: 400, message: 'Admin accounts cannot apply as sellers.' };
      }

      if (user.isBlocked) {
        throw { status: 403, message: 'Blocked accounts cannot apply as sellers.' };
      }

      if (user.sellerStatus === 'pending') {
        throw { status: 409, message: 'Your seller application is already under review.' };
      }

      if (user.sellerStatus === 'approved') {
        throw { status: 409, message: 'You are already an approved seller.' };
      }

      user.sellerStatus = 'pending';
      user.sellerApplication = {
        businessName: String(businessName).trim(),
        phone: String(phone).trim(),
        category: String(category).trim(),
        description: String(description).trim(),
        address: String(address).trim(),
        status: 'pending',
        submittedAt: new Date().toISOString(),
        reviewedAt: null,
        reviewedBy: null
      };

      return {
        sellerStatus: user.sellerStatus,
        application: user.sellerApplication
      };
    });

    res.status(201).json({
      message: 'Seller application submitted successfully. Please wait for admin approval.',
      ...result
    });
  } catch (e) {
    if (e.status) {
      return res.status(e.status).json({ error: e.message });
    }

    console.error('[Seller application]', e);
    res.status(500).json({ error: 'Could not submit seller application.' });
  }
});

// GET /api/users/seller-status
// Lets a logged-in user check their application status.
router.get('/seller-status', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.users.find(u => u.id === req.user.userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  res.json({
    sellerStatus: user.sellerStatus || 'not_applied',
    application: user.sellerApplication || null
  });
});

// PUT /api/users/change-password
router.put('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  try {
    withDb(db => {
      const user = db.users.find(u => u.id === req.user.userId);
      if (!user) throw { status: 404, message: 'User not found' };
      if (!verifyPassword(currentPassword, user.passwordHash, user.salt)) {
        throw { status: 401, message: 'Current password is incorrect' };
      }
      const { hash, salt } = hashPassword(newPassword);
      user.passwordHash = hash;
      user.salt = salt;
    });
    res.json({ message: 'Password changed successfully' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
