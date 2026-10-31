/**
 * Quick standalone SMTP test — verifies your EMAIL_* env vars can actually
 * log in and send, without going through the full signup/OTP flow.
 *
 * Usage:
 *   node Backend/scripts/testEmail.js you@example.com
 */
require('dotenv').config();
const { sendOtpEmail } = require('../mailer');

const to = process.argv[2];
if (!to) {
  console.error('Usage: node Backend/scripts/testEmail.js you@example.com');
  process.exit(1);
}

console.log('EMAIL_HOST:', process.env.EMAIL_HOST);
console.log('EMAIL_PORT:', process.env.EMAIL_PORT);
console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('EMAIL_PASS length:', (process.env.EMAIL_PASS || '').length, '(Gmail App Passwords are always 16 characters)');

sendOtpEmail({ to, name: 'Test', otp: '123456' })
  .then((info) => {
    console.log('\n✅ Sent successfully.');
    console.log(info);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Failed to send:');
    console.error(err.message);
    process.exit(1);
  });
