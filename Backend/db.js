/**
 * Kalakar – Simple file-based JSON database
 * Uses Node.js built-in fs/crypto (no external packages needed)
 *
 * Write operations are serialised through a simple promise queue to prevent
 * concurrent write races when multiple requests arrive simultaneously.
 *
 * ── IMPORTANT: serverless (Vercel) note ──────────────────────────────────
 * On Vercel, the deployed project bundle (everything under Backend/) is
 * mounted READ-ONLY. Only /tmp is writable, and /tmp is wiped whenever the
 * function's container recycles (cold start) — so this is fine for local
 * dev / traditional hosting (Railway, Render, a VPS, etc.) but on Vercel
 * data written at runtime (new users signing up, new orders, etc.) will NOT
 * persist across cold starts. This was the actual cause of "user can't
 * register / never gets the OTP": db.js was writing straight to
 * Backend/kalakar.db.json, which throws EROFS (read-only filesystem) the
 * moment Vercel handles the request — so registration failed before the
 * OTP email was ever sent.
 *
 * The fix below detects the serverless/read-only case and redirects writes
 * to /tmp, seeding /tmp from the bundled JSON file on first read so
 * existing products/admin data are still there for that container's
 * lifetime. This unblocks signup, but it is still NOT durable storage on
 * Vercel — for real persistence, swap this file for MongoDB (Navneet
 * already uses Mongoose elsewhere) or another hosted DB.
 */
const fs = require('fs');
const path = require('path');

const SEED_DB_PATH = path.join(__dirname, 'kalakar.db.json');
const TMP_DB_PATH = path.join('/tmp', 'kalakar.db.json');

// Is the bundle directory writable? Vercel (and most serverless platforms)
// mount everything except /tmp read-only. We check once, at require time.
function detectWritableDbPath() {
  if (process.env.VERCEL) return TMP_DB_PATH;
  try {
    fs.accessSync(__dirname, fs.constants.W_OK);
    return SEED_DB_PATH;
  } catch (e) {
    return TMP_DB_PATH;
  }
}

const DB_PATH = detectWritableDbPath();

// Initialize empty database structure
const defaultDb = () => ({
  users: [],      // { id, name, email, passwordHash, salt, isAdmin, isBlocked, isVerified,
                  //   otpHash, otpExpires, otpAttempts, otpLastSentAt, createdAt }
  addresses: [],  // { id, userId, name, phone, line1, line2, city, state, pincode, isDefault, createdAt }
  orders: [],     // { id, orderNumber, userId, items, address, subtotal, shipping, total,
                  //   paymentMethod, paymentStatus, status, createdAt, updatedAt }
  products: []    // { id, name, category, desc, price, oldPrice, img, sizes, stock,
                  //   badge, isActive, createdAt, updatedAt }
});

// If we're writing to /tmp but it hasn't been seeded yet this cold start,
// copy over the bundled seed file (read-only source) so products/admin
// accounts baked into the repo are still available.
function ensureSeeded() {
  if (DB_PATH !== TMP_DB_PATH) return;
  if (fs.existsSync(TMP_DB_PATH)) return;
  try {
    if (fs.existsSync(SEED_DB_PATH)) {
      fs.copyFileSync(SEED_DB_PATH, TMP_DB_PATH);
    }
  } catch (e) {
    console.error('[DB] Failed to seed /tmp database:', e.message);
  }
}

function load() {
  try {
    ensureSeeded();
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      // Ensure all collections exist (forward-compat)
      return { ...defaultDb(), ...parsed };
    }
  } catch (e) {
    console.error('[DB] Failed to load database, starting fresh:', e.message);
  }
  return defaultDb();
}

function save(db) {
  // Write to a temp file first, then rename — atomic on most OSes
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

function getDb() {
  return load();
}

let writeQueue = Promise.resolve();


function withDb(fn) {
  // For synchronous usage (current code)
  const db = load();
  const result = fn(db);
  save(db);
  return result;
}

module.exports = { getDb, withDb, save };
