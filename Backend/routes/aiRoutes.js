const express = require('express');
const https = require('https');
const router = express.Router();
const { getDb } = require('../db');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function groqRequest(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 25000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { parsed = { raw: data }; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        reject(new Error(parsed?.error?.message || `Groq request failed (${res.statusCode})`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Groq request timed out')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function normalizeProducts() {
  const db = getDb();
  return (db.products || [])
    .filter(p => p.isActive !== false)
    .map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.desc,
      price: Number(p.price) || 0,
      oldPrice: p.oldPrice || null,
      image: p.img,
      sizes: p.sizes || [],
      stock: Number(p.stock) || 0,
      badge: p.badge || ''
    }));
}

function fallbackMatch(products, query) {
  const q = String(query || '').toLowerCase();
  const budget = (q.match(/(?:under|below|less than|within)\s*₹?\s*([\d,]+)/i) || [])[1];
  const maxBudget = budget ? Number(budget.replace(/,/g, '')) : null;
  const words = q.split(/\W+/).filter(w => w.length > 2);

  return products
    .map(p => {
      let score = 0;
      const hay = `${p.name} ${p.category} ${p.description} ${p.badge}`.toLowerCase();
      words.forEach(w => { if (hay.includes(w)) score += 2; });
      if (maxBudget !== null) score += p.price <= maxBudget ? 4 : -4;
      if (p.stock > 0) score += 1;
      return { p, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.price - b.p.price)
    .slice(0, 3);
}

router.post('/product-finder', async (req, res) => {
  const query = String(req.body?.query || '').trim();
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];
  const products = normalizeProducts();

  if (!query) return res.status(400).json({ error: 'Tell me what you are looking for.' });
  if (!products.length) return res.status(503).json({ error: 'No products are currently available.' });

  // Never expose the API key to the browser. The browser only calls this server route.
  if (!process.env.GROQ_API_KEY) {
    const matches = fallbackMatch(products, query);
    return res.json({
      message: matches.length
        ? 'I found a few pieces that match your request.'
        : 'I could not find an exact match yet. Try a category, style, or budget.',
      recommendations: matches.map(x => ({
        productId: x.p.id,
        reason: 'Closest match from the current catalogue.',
        product: x.p
      })),
      fallback: true
    });
  }

  const compactCatalogue = products.map(p => ({
    id: p.id, name: p.name, category: p.category, description: p.description,
    price: p.price, oldPrice: p.oldPrice, sizes: p.sizes, stock: p.stock, badge: p.badge
  }));

  const system = `You are Kalakar's premium AI Product Finder.
Your job is to understand a shopper's natural-language requirements and recommend ONLY products from the supplied catalogue.
Never invent products, prices, sizes, stock, URLs, or product IDs.
Prioritize explicit requirements: category, use case, style, material, colour, size, budget, gifting intent and availability.
If the request is vague, make a tasteful best-effort recommendation rather than asking too many questions.
Return ONLY valid JSON with this exact shape:
{"message":"short warm explanation","recommendations":[{"productId":"existing-id","reason":"one concise reason"}]}
Return 1-3 recommendations.`;

  const user = JSON.stringify({
    shopperRequest: query,
    recentConversation: history,
    catalogue: compactCatalogue
  });

  try {
    const completion = await groqRequest({
      model: MODEL,
      temperature: 0.25,
      max_completion_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    });

    const raw = completion?.choices?.[0]?.message?.content || '{}';
    let result;
    try { result = JSON.parse(raw); } catch (_) { throw new Error('AI returned invalid JSON'); }

    const validIds = new Set(products.map(p => p.id));
    const recommendations = Array.isArray(result.recommendations)
      ? result.recommendations
          .filter(r => validIds.has(r.productId))
          .slice(0, 3)
          .map(r => ({
            productId: r.productId,
            reason: String(r.reason || 'A good match for your requirements.').slice(0, 180)
          }))
      : [];

    if (!recommendations.length) throw new Error('No valid recommendations returned');

    const byId = new Map(products.map(p => [p.id, p]));
    return res.json({
      message: String(result.message || 'Here are the pieces I think fit you best.').slice(0, 280),
      recommendations: recommendations.map(r => ({
        ...r,
        product: byId.get(r.productId)
      }))
    });
  } catch (error) {
    console.error('[AI Product Finder]', error.message);
    const matches = fallbackMatch(products, query);
    return res.json({
      message: matches.length
        ? 'I had a little trouble reaching the AI, so I matched your request against our current catalogue.'
        : 'I could not find an exact match. Try telling me your preferred category, style or budget.',
      recommendations: matches.map(x => ({
        productId: x.p.id,
        reason: 'Closest match from the current catalogue.',
        product: x.p
      })),
      fallback: true
    });
  }
});

module.exports = router;
