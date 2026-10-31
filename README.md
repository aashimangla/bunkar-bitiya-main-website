# Kalakar — Full-Stack Handcraft Ecommerce

A complete ecommerce website for handcrafted Indian art and woollen wear, with full backend, user auth, address management, and order tracking.

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
# or
node Backend/server.js

# 3. Open your browser
# → http://localhost:3000
```

That's it. No database setup needed — uses a file-based JSON store (`Backend/kalakar.db.json`) that is created automatically.

---

## 🏗️ Project Structure

```
kalakar-store/
├── Backend/
│   ├── server.js           ← Express server (port 3000)
│   ├── auth.js             ← JWT + password hashing (Node built-ins only)
│   ├── db.js               ← JSON file database
│   ├── kalakar.db.json     ← Auto-created database file
│   ├── middleware/
│   │   └── authMiddleware.js
│   └── routes/
│       ├── userRoutes.js   ← Register, login, profile
│       ├── addressRoutes.js← CRUD delivery addresses
│       └── orderRoutes.js  ← Place + view orders
├── Frontend/
│   ├── index.html          ← Main homepage (auth integrated)
│   ├── paintings.html
│   ├── wollen-wear.html
│   ├── handicrafted-gifts.html
│   ├── wall-art.html
│   └── newarrival.html
├── package.json
└── README.md
```

---

## 🔌 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/users/register` | Create account |
| POST | `/api/users/login` | Sign in, receive JWT |
| GET | `/api/users/me` | Get profile (auth required) |
| PUT | `/api/users/me` | Update name |
| PUT | `/api/users/change-password` | Change password |

### Addresses
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/addresses` | List user's addresses |
| POST | `/api/addresses` | Add new address |
| PUT | `/api/addresses/:id` | Edit address |
| DELETE | `/api/addresses/:id` | Delete address |
| PUT | `/api/addresses/:id/default` | Set as default |

### Orders
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/orders` | Place order |
| GET | `/api/orders` | Order history |
| GET | `/api/orders/:id` | Single order |

---

## 🔐 Authentication

- JWT tokens stored in `localStorage`
- Passwords hashed with PBKDF2-SHA512 (10,000 iterations) + random salt
- Tokens expire after 7 days
- No external auth packages — uses Node.js built-in `crypto`

### Example: Login

```js
const res = await fetch('/api/users/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'you@example.com', password: 'yourpassword' })
});
const { token, user } = await res.json();
// Store token and use in Authorization header
```

---

## ✨ Features Added

- **Sign In / Create Account** panel in the header
- **User dropdown** showing name, email, quick links
- **My Account panel** with:
  - Profile editing
  - Password change
  - Address book (add / edit / delete / set default)
  - Order history with status
- **Checkout flow**:
  - Logged-in users → address selection step before payment
  - New address can be added inline during checkout
  - Orders saved to database after payment
- **Guest checkout**: skips address step, no order saved
- All other pages (paintings, woollen-wear, etc.) work exactly as before

---

## 🛠️ Environment Variables (optional)

Create a `.env` file in the root:

```env
PORT=3000
JWT_SECRET=your_very_long_random_secret_here
```

If `JWT_SECRET` is not set, a default development secret is used (change this in production!).

---

## 📦 Dependencies

Only **Express** and **cors** are used — both already in `node_modules`.  
No MongoDB, no bcrypt, no jsonwebtoken package required.
