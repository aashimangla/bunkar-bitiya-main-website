/**
 * Kalakar – Email utility (Nodemailer)
 * Sends OTP verification emails during signup.
 *
 * Configure these in your .env file:
 *   EMAIL_HOST=smtp.gmail.com
 *   EMAIL_PORT=587
 *   EMAIL_USER=youraddress@gmail.com
 *   EMAIL_PASS=your_16_char_app_password
 *   EMAIL_FROM="Kalakar" <youraddress@gmail.com>
 *
 * If EMAIL_HOST/EMAIL_USER/EMAIL_PASS are not set, the server falls back to
 * "dev mode": the OTP is printed to the console instead of being emailed,
 * so local development still works without SMTP credentials. In production
 * (NODE_ENV=production) missing SMTP config will throw instead of silently
 * failing, so you don't ship a build that can't actually deliver OTPs.
 */
const nodemailer = require('nodemailer');

let transporter = null;
let initTried = false;

function isConfigured() {
  return !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function getTransporter() {
  if (transporter || initTried) return transporter;
  initTried = true;

  if (!isConfigured()) return null;

  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10) || 587,
    secure: (parseInt(process.env.EMAIL_PORT, 10) || 587) === 465, // true for port 465, false for others
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    // Without these, a slow/blocked SMTP handshake hangs the request
    // indefinitely — on Vercel that means the function just times out with
    // no useful error, which looks exactly like "the OTP never arrives".
    // These make a bad connection fail fast with a real error instead.
    connectionTimeout: 8000, // time to establish the TCP connection
    greetingTimeout: 8000,   // time to wait for the SMTP greeting
    socketTimeout: 10000     // time to wait on an idle socket
  });

  return transporter;
}

function otpEmailHtml(name, otp) {
  return `
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#faf8f5;border:1px solid #e8e2d8;">
    <div style="text-align:center;font-size:22px;letter-spacing:.14em;text-transform:uppercase;color:#1a1a1a;margin-bottom:24px;">
      Kala<span style="color:#b8763e;">kar</span>
    </div>
    <p style="font-size:14px;color:#333;line-height:1.6;">Hi ${name || 'there'},</p>
    <p style="font-size:14px;color:#333;line-height:1.6;">
      Thanks for signing up with Kalakar. Use the verification code below to confirm
      your email address and activate your account.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <span style="display:inline-block;font-size:32px;letter-spacing:.3em;font-weight:bold;color:#b8763e;background:#fff;border:1.5px solid #e8e2d8;padding:14px 24px;">
        ${otp}
      </span>
    </div>
    <p style="font-size:13px;color:#666;line-height:1.6;">
      This code expires in 10 minutes. If you didn't try to create a Kalakar account,
      you can safely ignore this email.
    </p>
    <p style="font-size:12px;color:#999;margin-top:32px;">— The Kalakar Team</p>
  </div>`;
}

/**
 * Sends a signup OTP email. Resolves regardless of transport outcome in dev
 * mode (logs to console); in production with SMTP configured, rejects if the
 * send genuinely fails so the caller can surface an error to the user.
 */
async function sendOtpEmail({ to, name, otp }) {
  const subject = 'Your Kalakar verification code';
  const text = `Hi ${name || 'there'},\n\nYour Kalakar verification code is: ${otp}\n\nThis code expires in 10 minutes. If you didn't request this, ignore this email.`;
  const html = otpEmailHtml(name, otp);

  const t = getTransporter();

  if (!t) {
    // Dev fallback — no SMTP configured
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email service is not configured (EMAIL_HOST/EMAIL_USER/EMAIL_PASS missing)');
    }
    console.log('\n──────────────────────────────────────────');
    console.log(`[DEV MODE] No SMTP configured — OTP for ${to}: ${otp}`);
    console.log('Set EMAIL_HOST / EMAIL_USER / EMAIL_PASS in .env to send real emails.');
    console.log('──────────────────────────────────────────\n');
    return { dev: true };
  }

  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  try {
    return await t.sendMail({ from, to, subject, text, html });
  } catch (err) {
    // Surface the common Gmail failure modes with an actionable message
    // instead of a raw SMTP error code.
    if (err.responseCode === 535 || /invalid login|username and password not accepted/i.test(err.message || '')) {
      throw new Error('SMTP login rejected — the EMAIL_USER/EMAIL_PASS in your .env are not being accepted. Regenerate a fresh Gmail App Password (16 characters, no spaces) at https://myaccount.google.com/apppasswords and update EMAIL_PASS.');
    }
    if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKET' || err.code === 'ECONNECTION') {
      throw new Error('Could not reach the SMTP server (connection timed out). Check EMAIL_HOST/EMAIL_PORT, and that outbound SMTP isn\'t blocked on your hosting provider.');
    }
    throw err;
  }
}

module.exports = { sendOtpEmail, isConfigured };
