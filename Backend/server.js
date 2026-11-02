require('dotenv').config();
const express = require('express');
const path    = require('path');
const cors    = require('cors');

const userRoutes    = require('./routes/userRoutes');
const addressRoutes = require('./routes/addressRoutes');
const orderRoutes   = require('./routes/orderRoutes');
const productRoutes = require('./routes/productRoutes');
const sellerProductRoutes = require('./routes/sellerProductRoutes');
const adminRoutes   = require('./routes/adminRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const aiRoutes      = require('./routes/aiRoutes');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));

// ── Razorpay webhook needs the RAW request body to verify its signature, so
//    this must be registered BEFORE the global express.json() parser below,
//    and only for this one route. Every other route still gets normal JSON.
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Serve static frontend files ───────────────────────────────────────────────
const FRONTEND = path.join(__dirname, '..', 'Frontend');
app.use(express.static(FRONTEND));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/users',     userRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/orders',    orderRoutes);
app.use('/api/products',        productRoutes);
app.use('/api/seller/products', sellerProductRoutes);
app.use('/api/admin',           adminRoutes);
app.use('/api/payments',  paymentRoutes);
app.use('/api/ai',       aiRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── SPA fallback: serve index.html for any non-API route ─────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(FRONTEND, 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server (local/traditional hosting only — not run on Vercel) ────────
if (require.main === module) {
  const PORT = parseInt(process.env.PORT, 10) || 3001;

  const server = app.listen(PORT, () => {
    console.log('\n╔════════════════════════════════════════╗');
    console.log(`║    Kalakar Store is running!          ║`);
    console.log(`║    http://localhost:${PORT}               ║`);
    console.log('╚════════════════════════════════════════╝\n');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌  Port ${PORT} is already in use!\n`);
      console.error(`   Fix 1: Kill the old process and run npm start again`);
      console.error(`   Fix 2: Use a different port:\n`);
      console.error(`          Windows:  set PORT=3001 && npm start`);
      console.error(`          Mac/Linux: PORT=3001 npm start\n`);
      process.exit(1);
    }
    throw err;
  });
}

module.exports = app;
