# Kalakar AI Product Finder

The navbar now includes a premium **AI Product Finder** powered by Groq.

## Architecture

Browser → `POST /api/ai/product-finder` → Node/Express → Groq → catalogue-aware recommendations → browser

The Groq secret is server-side only. It is **not** embedded in `Frontend/index.html`.

## Environment variables

Add these to your local `.env`:

```env
GROQ_API_KEY=YOUR_GROQ_KEY
GROQ_MODEL=llama-3.3-70b-versatile
```

For Vercel, add the same variables under **Project Settings → Environment Variables**, then redeploy.

## What was added

- `Backend/routes/aiRoutes.js`
  - Reads the current product catalogue from `Backend/db.js`
  - Sends only catalogue data + shopper request to Groq
  - Uses `llama-3.3-70b-versatile`
  - Validates returned product IDs so the model cannot invent catalogue items
  - Includes a local catalogue-matching fallback if Groq is unavailable
- `Backend/server.js`
  - Mounts the route at `/api/ai`
- `Frontend/index.html`
  - Adds **AI Product Finder** to the desktop navbar
  - Adds premium modal/chat UI
  - Adds responsive mobile layout
  - Adds suggestion chips
  - Displays AI-selected catalogue products with image, price, reason and category link

## Important security note

Do not put the Groq API key in frontend JavaScript, HTML, GitHub, or a public `.env` file. If a real API key has already been pasted into a public place or committed to a repository, rotate/revoke it in Groq and replace it with a new server-side environment variable.
