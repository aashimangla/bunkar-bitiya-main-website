const Razorpay = require('razorpay');

let instance = null;

// Lazily creates the Razorpay client so the app can still boot (and every
// other route can still work) even if Razorpay hasn't been configured yet.
// The clear error only surfaces when a payment route is actually hit.
function getRazorpay() {
  if (instance) return instance;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw {
      status: 500,
      message: 'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your .env file (see .env.example).'
    };
  }

  instance = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return instance;
}

module.exports = { getRazorpay };
