/**
 * Kalakar — create or promote an admin account.
 *
 * Usage:
 *   node Backend/scripts/createAdmin.js <email> <password> [name]
 *
 * - If a user with that email already exists, they are promoted to admin
 *   (the password argument is ignored in that case).
 * - Otherwise a brand new admin user is created with the given
 *   email/password/name.
 */
const { hashPassword, generateId } = require('../auth');
const { withDb } = require('../db');

const [, , email, password, name] = process.argv;

if (!email || !password) {
  console.log('Usage: node Backend/scripts/createAdmin.js <email> <password> [name]');
  process.exit(1);
}

const emailLower = email.toLowerCase().trim();

const result = withDb(db => {
  let user = db.users.find(u => u.email === emailLower);

  if (user) {
    user.isAdmin = true;
    user.isBlocked = false;
    return { user, created: false };
  }

  const { hash, salt } = hashPassword(password);
  user = {
    id: generateId(),
    name: name || 'Admin',
    email: emailLower,
    passwordHash: hash,
    salt,
    isAdmin: true,
    isBlocked: false,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  return { user, created: true };
});

if (result.created) {
  console.log(`✅ Admin account created:\n   Email:    ${result.user.email}\n   Password: ${password}\n\nLog in at /admin/login.html`);
} else {
  console.log(`✅ Existing user promoted to admin: ${result.user.email}\n\nLog in at /admin/login.html with their existing password.`);
}
