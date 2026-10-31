/**
 * Kalakar — seed the products collection.
 * Populates db.products from the catalog that used to be hardcoded in the
 * frontend pages, so the admin panel has real data to manage from day one.
 * Safe to re-run: it only seeds if the products collection is currently empty.
 *
 * Usage: node Backend/scripts/seedProducts.js
 */
const { generateId } = require('../auth');
const { withDb } = require('../db');

const seedData = [
  { name: 'Himalayan Sunrise', category: 'Oil Painting', desc: 'Oil on canvas · 18×24 in', price: 4800, img: 'https://images.unsplash.com/photo-1580136608922-bf7a14f9d0ae?w=600&q=80', badge: 'New', sizes: ['12×16', '18×24', '24×36'], stock: 8 },
  { name: 'Pure Pashmina Shawl', category: 'Woollen Wear', desc: 'Kashmiri hand-woven · Ivory', price: 2400, oldPrice: 3200, img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80', badge: 'Sale', sizes: ['S', 'M', 'L', 'XL'], stock: 15 },
  { name: 'Abstract Bloom', category: 'Acrylic Painting', desc: 'Acrylic on canvas · 12×16 in', price: 2600, img: 'https://images.unsplash.com/photo-1579762593131-b8945254345a?w=600&q=80', sizes: ['12×16', '18×24'], stock: 6 },
  { name: 'Merino Cardigan', category: 'Knit Wear', desc: 'Hand-knit · Earthy beige', price: 3800, img: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=600&q=80', badge: 'New', sizes: ['S', 'M', 'L', 'XL'], stock: 10 },
  { name: 'Himalayan Wrap', category: 'Woollen Wear', desc: 'Thick weave · Charcoal grey', price: 2900, img: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600&q=80', sizes: ['One Size'], stock: 12 },
  { name: 'Morning Mist', category: 'Watercolour', desc: 'Watercolour on paper · 10×14 in', price: 1800, img: 'https://images.unsplash.com/photo-1605347220242-04d3b97ceee9?w=600&q=80', badge: 'Limited', sizes: ['10×14', '14×20'], stock: 4 },
  { name: 'Forest Light', category: 'Oil Painting', desc: 'Oil on board · 16×20 in', price: 5200, img: 'https://images.unsplash.com/photo-1578926288207-32356f8e7281?w=600&q=80', sizes: ['16×20', '24×30'], stock: 7 },
  { name: 'Angora Scarf', category: 'Woollen Wear', desc: 'Softspun · Dusty rose', price: 1100, oldPrice: 1600, img: 'https://images.unsplash.com/photo-1580136608922-bf7a14f9d0ae?w=600&q=80', badge: 'Sale', sizes: ['One Size'], stock: 20 },
  { name: 'Valley Mist', category: 'Oil Painting', desc: 'Oil on canvas · 20×28 in', price: 6200, img: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=600&q=80', badge: 'New', sizes: ['20×28', '30×40'], stock: 3 },
  { name: 'Kashmiri Kalamkari', category: 'Handcrafted Gift', desc: 'Hand-painted fabric art · 12×18 in', price: 1600, img: 'https://images.unsplash.com/photo-1561059488-916d69792237?w=600&q=80', sizes: ['12×18'], stock: 9 },
  { name: 'Copper Dhokra Figurine', category: 'Handcrafted Gift', desc: 'Lost-wax cast · 6 in tall', price: 2200, img: 'https://images.unsplash.com/photo-1585518433608-a4c13c15f2c5?w=600&q=80', badge: 'Limited', sizes: ['One Size'], stock: 5 },
  { name: 'Moonlit Peaks', category: 'Watercolour', desc: 'Watercolour on cotton paper · 14×20 in', price: 3100, img: 'https://images.unsplash.com/photo-1547891654-e66ed7ebb968?w=600&q=80', sizes: ['14×20', '21×30'], stock: 11 }
];

const result = withDb(db => {
  if (db.products.length > 0) {
    return { seeded: false, count: db.products.length };
  }
  const now = new Date().toISOString();
  db.products = seedData.map(p => ({
    id: generateId(),
    isActive: true,
    oldPrice: null,
    badge: null,
    createdAt: now,
    updatedAt: now,
    ...p
  }));
  return { seeded: true, count: db.products.length };
});

if (result.seeded) {
  console.log(`✅ Seeded ${result.count} products into the database.`);
} else {
  console.log(`ℹ️  Products already exist (${result.count}) — skipped seeding to avoid duplicates.`);
}
