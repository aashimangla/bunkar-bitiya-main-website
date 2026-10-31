/* ═══ KALAKAR — shared chrome behaviour for content pages ═══ */
let cart = [];

/* CURSOR */
const cur = document.getElementById('cursor'), ring = document.getElementById('cursorRing');
document.addEventListener('mousemove', e => {
  cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px';
  setTimeout(() => { ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; }, 65);
});
function bindCursor() {
  document.querySelectorAll('a,button,.product-card,.cat-showcase-item').forEach(el => {
    el.addEventListener('mouseenter', () => cur.classList.add('expand'));
    el.addEventListener('mouseleave', () => cur.classList.remove('expand'));
  });
}
bindCursor();

/* MOBILE NAV */
document.getElementById('mobMenuBtn').addEventListener('click', () => {
  document.getElementById('mobNav').classList.add('open');
  document.getElementById('mobOverlay').classList.add('open');
});
function closeMobNav() {
  document.getElementById('mobNav').classList.remove('open');
  document.getElementById('mobOverlay').classList.remove('open');
}

/* WISHLIST — content pages have no catalog/account UI of their own, so the
   heart icon sends people to the dashboard's Wishlist tab where their saved
   items (and everything else about their account) actually live. */
const wishBtnEl = document.getElementById('wishBtn');
if (wishBtnEl) {
  wishBtnEl.addEventListener('click', () => { location.href = 'dashboard.html#wishlist'; });
}

/* SEARCH — points people to the shop pages since this page has no catalog */
document.getElementById('searchBtn').addEventListener('click', () => {
  document.getElementById('searchDrawer').classList.add('open');
  setTimeout(() => document.getElementById('searchInput').focus(), 350);
});
function closeSearch() {
  document.getElementById('searchDrawer').classList.remove('open');
  document.getElementById('searchResults').classList.remove('show');
}
document.getElementById('searchInput').addEventListener('input', function () {
  const q = this.value.toLowerCase().trim();
  const res = document.getElementById('searchResults');
  if (!q) { res.classList.remove('show'); return; }
  res.innerHTML = `<p style="font-size:13px;color:var(--muted);padding:12px 0;">Press enter to search our full catalogue for "<strong>${this.value}</strong>".</p>
    <div class="sri" onclick="location.href='paintings.html'"><div><div class="sri-n">Browse Paintings</div><div class="sri-p">Shop original artworks</div></div></div>
    <div class="sri" onclick="location.href='wollen-wear.html'"><div><div class="sri-n">Browse Woollen Wear</div><div class="sri-p">Shop handwoven textiles</div></div></div>
    <div class="sri" onclick="location.href='handicrafted-gifts.html'"><div><div class="sri-n">Browse Handcrafted Gifts</div><div class="sri-p">Shop artisan gifting</div></div></div>`;
  res.classList.add('show');
});

/* CART (empty shell — cart state is per-page across this demo site) */
function openCart() { document.getElementById('cartDrawer').classList.add('open'); document.getElementById('cartOverlay').classList.add('open'); }
function closeCart() { document.getElementById('cartDrawer').classList.remove('open'); document.getElementById('cartOverlay').classList.remove('open'); }
document.getElementById('cartBtn').addEventListener('click', openCart);

/* SCROLL */
window.addEventListener('scroll', () => {
  document.getElementById('siteHeader').classList.toggle('scrolled', window.scrollY > 60);
  document.getElementById('scrollTop').classList.toggle('show', window.scrollY > 400);
});
document.getElementById('scrollTop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

/* TOAST */
function showToast(msg) {
  const w = document.getElementById('toastWrap');
  const t = document.createElement('div'); t.className = 'toast-msg'; t.textContent = msg;
  w.appendChild(t); requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3000);
}
function footerSub() {
  const v = document.getElementById('footerEmail').value;
  if (!v || !v.includes('@')) { showToast('Please enter a valid email.'); return; }
  showToast('Subscribed! 🎉'); document.getElementById('footerEmail').value = '';
}

/* MOBILE RESP */
function handleResize() { const b = document.getElementById('mobMenuBtn'); b.style.display = window.innerWidth <= 768 ? 'flex' : 'none'; }
window.addEventListener('resize', handleResize); handleResize();

/* ESC */
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSearch(); closeCart(); closeMobNav(); } });
