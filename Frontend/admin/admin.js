/* ═══ KALAKAR ADMIN — dashboard logic ═══ */

const token = localStorage.getItem('kalakar_admin_token');
if (!token) window.location.href = 'login.html';

/* ── API helper ── */
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    if (res.status === 401) {
      localStorage.removeItem('kalakar_admin_token');
      localStorage.removeItem('kalakar_admin_user');
      window.location.href = 'login.html';
      return new Promise(() => {}); // halt further execution on this path
    }
    throw new Error(data.error || 'Access denied');
  }
  if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
  return data;
}

/* ── Toast ── */
function toast(msg, isErr = false) {
  const wrap = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

/* ── Admin identity chip ── */
(function initAdminChip() {
  try {
    const u = JSON.parse(localStorage.getItem('kalakar_admin_user') || '{}');
    document.getElementById('adminName').textContent = u.name || 'Admin';
    document.getElementById('adminEmail').textContent = u.email || '';
    document.getElementById('adminInitial').textContent = (u.name || 'A').charAt(0).toUpperCase();
  } catch (e) { /* ignore */ }
})();

document.getElementById('logoutBtn').addEventListener('click', (e) => {
  e.preventDefault();
  localStorage.removeItem('kalakar_admin_token');
  localStorage.removeItem('kalakar_admin_user');
  window.location.href = 'login.html';
});

/* ── View routing ── */
const views = [
  'dashboard',
  'orders',
  'products',
  'seller-applications',
  'users'
];
function showView(name) {
  views.forEach(v => document.getElementById('view-' + v).classList.toggle('active', v === name));
  document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  closeSidebar();
  if (name === 'dashboard') loadDashboard();
  if (name === 'orders') loadOrders();
  if (name === 'products') loadProducts();
  if (name === 'seller-applications') loadSellerApplications();
  if (name === 'users') loadUsers();
}
document.querySelectorAll('[data-view]').forEach(el => {
  el.addEventListener('click', (e) => { e.preventDefault(); showView(el.dataset.view); });
});

/* ── Mobile sidebar ── */
const sidebar = document.getElementById('sidebar');
const scrim = document.getElementById('scrim');
function openSidebar() { sidebar.classList.add('open'); scrim.classList.add('open'); }
function closeSidebar() { sidebar.classList.remove('open'); scrim.classList.remove('open'); }
[
  'mobToggle1',
  'mobToggle2',
  'mobToggle3',
  'mobToggle4',
  'mobToggle5'
].forEach(id => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', openSidebar);
});
scrim.addEventListener('click', closeSidebar);

function fmtMoney(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
function fmtDate(d) { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ═══════════════════════ DASHBOARD ═══════════════════════ */
async function loadDashboard() {
  const grid = document.getElementById('statsGrid');
  const body = document.getElementById('recentOrdersBody');
  try {
    const s = await api('/api/admin/stats');
    grid.innerHTML = `
      <div class="stat-card"><div class="stat-label">Total Revenue</div><div class="stat-value accent">${fmtMoney(s.totalRevenue)}</div></div>
      <div class="stat-card"><div class="stat-label">Orders</div><div class="stat-value">${s.totalOrders}</div></div>
      <div class="stat-card"><div class="stat-label">Products</div><div class="stat-value">${s.totalProducts}</div></div>
      <div class="stat-card"><div class="stat-label">Registered Users</div><div class="stat-value">${s.totalUsers}</div></div>
    `;
    body.innerHTML = s.recentOrders.length ? s.recentOrders.map(o => `
      <tr>
        <td class="cell-strong">${esc(o.orderNumber)}</td>
        <td>${esc(o.customerName)}</td>
        <td>${fmtMoney(o.total)}</td>
        <td><span class="badge ${o.status}">${esc(o.status)}</span></td>
        <td class="cell-muted">${fmtDate(o.createdAt)}</td>
      </tr>`).join('') : `<tr class="empty-row"><td colspan="5">No orders yet.</td></tr>`;
  } catch (e) {
    grid.innerHTML = `<div class="loading-row">Couldn't load stats: ${esc(e.message)}</div>`;
    toast(e.message, true);
  }
}

/* ═══════════════════════ ORDERS ═══════════════════════ */
let allOrders = [];
async function loadOrders() {
  const body = document.getElementById('ordersBody');
  body.innerHTML = `<tr class="empty-row"><td colspan="8">Loading…</td></tr>`;
  try {
    allOrders = await api('/api/admin/orders');
    renderOrders();
  } catch (e) {
    body.innerHTML = `<tr class="empty-row"><td colspan="8">Couldn't load orders: ${esc(e.message)}</td></tr>`;
  }
}
function prettyStatus(s) { return String(s || '').replace(/_/g, ' '); }

function renderOrders() {
  const body = document.getElementById('ordersBody');
  const q = document.getElementById('orderSearch').value.trim().toLowerCase();
  const status = document.getElementById('orderStatusFilter').value;

  let list = allOrders;
  if (status) list = list.filter(o => o.status === status);
  if (q) list = list.filter(o => o.orderNumber.toLowerCase().includes(q) || (o.customerEmail || '').toLowerCase().includes(q) || (o.customerName || '').toLowerCase().includes(q));

  if (!list.length) { body.innerHTML = `<tr class="empty-row"><td colspan="8">No orders match.</td></tr>`; return; }

  const statuses = ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
  body.innerHTML = list.map(o => `
    <tr>
      <td class="cell-strong">${esc(o.orderNumber)}</td>
      <td>${esc(o.customerName)}<div class="cell-muted">${esc(o.customerEmail)}</div></td>
      <td class="cell-muted">${o.items.length} item${o.items.length === 1 ? '' : 's'}</td>
      <td>${fmtMoney(o.total)}</td>
      <td>
        <div class="cell-muted">${esc((o.paymentMethod || '').toUpperCase())}</div>
        <span class="badge ${o.paymentStatus}">${esc(prettyStatus(o.paymentStatus))}</span>
      </td>
      <td>
        ${o.status === 'pending_payment' || o.paymentStatus === 'failed'
          ? `<span class="badge ${o.status}">${esc(prettyStatus(o.status))}</span>`
          : `<select class="select-status" data-order-id="${o.id}" data-current="${o.status}">
              ${statuses.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
            </select>`}
      </td>
      <td class="cell-muted">${fmtDate(o.createdAt)}</td>
      <td style="white-space:nowrap;">
        <button class="btn-icon" data-view-order="${o.id}" title="View details"><i class="bi bi-eye"></i></button>
        ${o.paymentMethod === 'razorpay' && o.paymentStatus === 'paid' ? `<button class="btn-icon" data-refund-order="${o.id}" title="Refund" style="color:var(--danger);"><i class="bi bi-arrow-counterclockwise"></i></button>` : ''}
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('select[data-order-id]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.orderId;
      const newStatus = sel.value;
      const prev = sel.dataset.current;
      try {
        await api(`/api/admin/orders/${id}/status`, 'PUT', { status: newStatus });
        sel.dataset.current = newStatus;
        toast(`Order marked as ${newStatus}.`);
        const o = allOrders.find(o => o.id === id);
        if (o) o.status = newStatus;
        loadDashboard();
      } catch (e) {
        sel.value = prev;
        toast(e.message, true);
      }
    });
  });
  body.querySelectorAll('[data-view-order]').forEach(btn => {
    btn.addEventListener('click', () => openOrderModal(btn.dataset.viewOrder));
  });
  body.querySelectorAll('[data-refund-order]').forEach(btn => {
    btn.addEventListener('click', () => refundOrder(btn.dataset.refundOrder));
  });
}
document.getElementById('orderSearch').addEventListener('input', renderOrders);
document.getElementById('orderStatusFilter').addEventListener('change', renderOrders);
document.getElementById('refreshOrders').addEventListener('click', loadOrders);

async function refundOrder(id) {
  const o = allOrders.find(o => o.id === id);
  if (!o) return;
  if (!confirm(`Refund ${fmtMoney(o.total)} for order ${o.orderNumber}? This can't be undone.`)) return;
  try {
    await api(`/api/admin/orders/${id}/refund`, 'POST', {});
    toast('Refund processed.');
    loadOrders();
    loadDashboard();
  } catch (e) {
    toast(e.message, true);
  }
}

function openOrderModal(id) {
  const o = allOrders.find(o => o.id === id);
  if (!o) return;
  const body = document.getElementById('orderDetailBody');
  body.innerHTML = `
    <div class="field-hint" style="margin-bottom:14px;">
      <strong>${esc(o.orderNumber)}</strong> · ${fmtDate(o.createdAt)} · <span class="badge ${o.status}">${esc(o.status)}</span>
    </div>
    <div style="margin-bottom:16px;">
      <div class="stat-label" style="margin-bottom:6px;">Customer</div>
      <div>${esc(o.customerName)}</div>
      <div class="cell-muted">${esc(o.customerEmail)}</div>
    </div>
    <div style="margin-bottom:16px;">
      <div class="stat-label" style="margin-bottom:6px;">Delivery Address</div>
      <div class="cell-muted">${esc(o.address.line1)}${o.address.line2 ? ', ' + esc(o.address.line2) : ''}, ${esc(o.address.city)}, ${esc(o.address.state)} - ${esc(o.address.pincode)}</div>
    </div>
    <div style="margin-bottom:16px;">
      <div class="stat-label" style="margin-bottom:6px;">Items</div>
      ${o.items.map(i => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">
        <span>${esc(i.name)}${i.selectedSize ? ' (' + esc(i.selectedSize) + ')' : ''} × ${i.qty}</span>
        <span>${fmtMoney(i.price * i.qty)}</span>
      </div>`).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;padding-top:6px;">
      <span class="cell-muted">Subtotal</span><span>${fmtMoney(o.subtotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;">
      <span class="cell-muted">Shipping</span><span>${o.shipping ? fmtMoney(o.shipping) : 'Free'}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-weight:600;margin-top:6px;">
      <span>Total</span><span>${fmtMoney(o.total)}</span>
    </div>
  `;
  document.getElementById('orderModalOverlay').classList.add('open');
}
document.getElementById('orderCloseBtn').addEventListener('click', () => document.getElementById('orderModalOverlay').classList.remove('open'));

/* ═══════════════════════ PRODUCTS ═══════════════════════ */
let allProducts = [];
async function loadProducts() {
  const body = document.getElementById('productsBody');
  body.innerHTML = `<tr class="empty-row"><td colspan="5">Loading…</td></tr>`;
  try {
    allProducts = await api('/api/admin/products');
    renderProducts();
  } catch (e) {
    body.innerHTML = `<tr class="empty-row"><td colspan="5">Couldn't load products: ${esc(e.message)}</td></tr>`;
  }
}
function renderProducts() {
  const body = document.getElementById('productsBody');
  const q = document.getElementById('productSearch').value.trim().toLowerCase();
  let list = allProducts;
  if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));

  if (!list.length) { body.innerHTML = `<tr class="empty-row"><td colspan="5">No products match.</td></tr>`; return; }

  body.innerHTML = list.map(p => `
    <tr>
      <td>
        <div class="prod-cell">
          <img class="prod-thumb" src="${esc(p.img || 'https://placehold.co/80x80/e4ddd5/7a746d?text=%20')}" alt="" onerror="this.src='https://placehold.co/80x80/e4ddd5/7a746d?text=%20'" />
          <div><div class="prod-name">${esc(p.name)}</div><div class="prod-cat">${esc(p.category)}</div></div>
        </div>
      </td>
      <td>${p.oldPrice ? `<span class="cell-muted" style="text-decoration:line-through;">${fmtMoney(p.oldPrice)}</span> ` : ''}${fmtMoney(p.price)}</td>
      <td class="${p.stock === 0 ? 'cell-muted' : ''}">${p.stock}</td>
      <td><span class="badge ${p.isActive !== false ? 'active-yes' : 'active-no'}">${p.isActive !== false ? 'Active' : 'Hidden'}</span></td>
      <td>
        <button class="btn-icon" data-edit-product="${p.id}" title="Edit"><i class="bi bi-pencil"></i></button>
        <button class="btn-icon" data-delete-product="${p.id}" title="Delete" style="color:var(--danger);"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('[data-edit-product]').forEach(btn => btn.addEventListener('click', () => openProductModal(btn.dataset.editProduct)));
  body.querySelectorAll('[data-delete-product]').forEach(btn => btn.addEventListener('click', () => deleteProduct(btn.dataset.deleteProduct)));
}
document.getElementById('productSearch').addEventListener('input', renderProducts);

async function deleteProduct(id) {
  const p = allProducts.find(p => p.id === id);
  if (!confirm(`Delete "${p ? p.name : 'this product'}"? This can't be undone.`)) return;
  try {
    await api(`/api/admin/products/${id}`, 'DELETE');
    toast('Product deleted.');
    loadProducts();
  } catch (e) { toast(e.message, true); }
}

/* ── Product modal ── */
const productModal = document.getElementById('productModalOverlay');
function openProductModal(id = null) {
  const form = document.getElementById('productForm');
  form.reset();
  document.getElementById('pId').value = '';
  document.getElementById('pActive').value = 'true';

  if (id) {
    const p = allProducts.find(p => p.id === id);
    document.getElementById('productModalTitle').textContent = 'Edit Product';
    document.getElementById('pId').value = p.id;
    document.getElementById('pName').value = p.name;
    document.getElementById('pCategory').value = p.category;
    document.getElementById('pPrice').value = p.price;
    document.getElementById('pOldPrice').value = p.oldPrice || '';
    document.getElementById('pStock').value = p.stock;
    document.getElementById('pDesc').value = p.desc || '';
    document.getElementById('pImg').value = p.img || '';
    document.getElementById('pSizes').value = (p.sizes || []).join(', ');
    document.getElementById('pBadge').value = p.badge || '';
    document.getElementById('pActive').value = String(p.isActive !== false);
  } else {
    document.getElementById('productModalTitle').textContent = 'Add Product';
  }
  productModal.classList.add('open');
}
document.getElementById('addProductBtn').addEventListener('click', () => openProductModal());
document.getElementById('productCancelBtn').addEventListener('click', () => productModal.classList.remove('open'));

document.getElementById('productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('pId').value;
  const payload = {
    name: document.getElementById('pName').value.trim(),
    category: document.getElementById('pCategory').value.trim(),
    price: Number(document.getElementById('pPrice').value),
    oldPrice: document.getElementById('pOldPrice').value ? Number(document.getElementById('pOldPrice').value) : null,
    stock: Number(document.getElementById('pStock').value),
    desc: document.getElementById('pDesc').value.trim(),
    img: document.getElementById('pImg').value.trim(),
    sizes: document.getElementById('pSizes').value.split(',').map(s => s.trim()).filter(Boolean),
    badge: document.getElementById('pBadge').value || null,
    isActive: document.getElementById('pActive').value === 'true'
  };
  const btn = document.getElementById('productSaveBtn');
  btn.disabled = true;
  try {
    if (id) await api(`/api/admin/products/${id}`, 'PUT', payload);
    else await api('/api/admin/products', 'POST', payload);
    toast(id ? 'Product updated.' : 'Product added.');
    productModal.classList.remove('open');
    loadProducts();
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
});

/* ═══════════════════════ SELLER APPLICATIONS ═══════════════════════ */

let allSellerApplications = [];

async function loadSellerApplications() {
  const body = document.getElementById('sellerApplicationsBody');
  const filter = document.getElementById('sellerApplicationFilter');

  body.innerHTML = `
    <tr class="empty-row">
      <td colspan="7">Loading applications…</td>
    </tr>
  `;

  try {
    const status = filter.value;
    const query = status
      ? `?status=${encodeURIComponent(status)}`
      : '';

    allSellerApplications = await api(
      '/api/admin/seller-applications' + query
    );

    renderSellerApplications();
  } catch (e) {
    body.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">
          Couldn't load applications: ${esc(e.message)}
        </td>
      </tr>
    `;
  }
}

function renderSellerApplications() {
  const body = document.getElementById('sellerApplicationsBody');

  if (!allSellerApplications.length) {
    body.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">No seller applications found.</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = allSellerApplications.map(application => `
    <tr>
      <td>
        <div class="cell-strong">${esc(application.name)}</div>
        <div class="cell-muted">${esc(application.email)}</div>
      </td>

      <td class="cell-strong">
        ${esc(application.businessName)}
      </td>

      <td>${esc(application.category)}</td>

      <td>${esc(application.phone)}</td>

      <td>
        <details>
          <summary style="cursor:pointer;color:var(--accent);">
            View details
          </summary>
          <div class="cell-muted" style="min-width:180px;margin-top:8px;">
            <strong>Address:</strong>
            ${esc(application.address)}
            <br><br>
            <strong>Description:</strong>
            ${esc(application.description)}
            ${application.reviewNote ? `
              <br><br>
              <strong>Review note:</strong>
              ${esc(application.reviewNote)}
            ` : ''}
          </div>
        </details>
      </td>

      <td>
        <span class="badge ${esc(application.status)}">
          ${esc(application.status)}
        </span>
      </td>

      <td style="white-space:nowrap;">
        ${application.status === 'pending' ? `
          <button
            class="btn btn-sm"
            data-approve-seller="${esc(application.userId)}"
            style="background:var(--ok-bg);color:var(--ok);">
            Approve
          </button>

          <button
            class="btn btn-sm"
            data-reject-seller="${esc(application.userId)}"
            style="background:var(--danger-bg);color:var(--danger);">
            Reject
          </button>
        ` : `
          <span class="cell-muted">Reviewed</span>
        `}
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('[data-approve-seller]').forEach(button => {
    button.addEventListener('click', () => {
      reviewSellerApplication(
        button.dataset.approveSeller,
        'approved'
      );
    });
  });

  body.querySelectorAll('[data-reject-seller]').forEach(button => {
    button.addEventListener('click', () => {
      reviewSellerApplication(
        button.dataset.rejectSeller,
        'rejected'
      );
    });
  });
}

async function reviewSellerApplication(userId, status) {
  const application = allSellerApplications.find(
    item => item.userId === userId
  );

  if (!application) return;

  const action = status === 'approved' ? 'approve' : 'reject';

  if (!confirm(
    `Are you sure you want to ${action} ${application.businessName}'s application?`
  )) {
    return;
  }

  try {
    await api(
      `/api/admin/seller-applications/${encodeURIComponent(userId)}`,
      'PUT',
      { status }
    );

    toast(`Seller application ${status}.`);
    await loadSellerApplications();
  } catch (e) {
    toast(e.message, true);
  }
}

document.getElementById('sellerApplicationFilter')
  .addEventListener('change', loadSellerApplications);

document.getElementById('refreshSellerApplications')
  .addEventListener('click', loadSellerApplications);

/* ═══════════════════════ USERS ═══════════════════════ */
let allUsers = [];
async function loadUsers() {
  const body = document.getElementById('usersBody');
  body.innerHTML = `<tr class="empty-row"><td colspan="7">Loading…</td></tr>`;
  try {
    allUsers = await api('/api/admin/users');
    renderUsers();
  } catch (e) {
    body.innerHTML = `<tr class="empty-row"><td colspan="7">Couldn't load users: ${esc(e.message)}</td></tr>`;
  }
}
function renderUsers() {
  const body = document.getElementById('usersBody');
  const q = document.getElementById('userSearch').value.trim().toLowerCase();
  let list = allUsers;
  if (q) list = list.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));

  if (!list.length) { body.innerHTML = `<tr class="empty-row"><td colspan="7">No users match.</td></tr>`; return; }

  const me = JSON.parse(localStorage.getItem('kalakar_admin_user') || '{}');

  body.innerHTML = list.map(u => `
    <tr>
      <td class="cell-strong">${esc(u.name)}</td>
      <td class="cell-muted">${esc(u.email)}</td>
      <td>${u.orderCount}</td>
      <td><span class="badge ${u.isAdmin ? 'admin' : 'active-no'}">${u.isAdmin ? 'Admin' : 'Customer'}</span></td>
      <td><span class="badge ${u.isBlocked ? 'blocked' : 'active-yes'}">${u.isBlocked ? 'Blocked' : 'Active'}</span></td>
      <td class="cell-muted">${fmtDate(u.createdAt)}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm" data-toggle-admin="${u.id}" data-val="${!u.isAdmin}" ${u.id === me.id ? 'disabled title="You can\'t change your own role"' : ''}>${u.isAdmin ? 'Remove admin' : 'Make admin'}</button>
        <button class="btn btn-sm" data-toggle-block="${u.id}" data-val="${!u.isBlocked}">${u.isBlocked ? 'Unblock' : 'Block'}</button>
        <button class="btn-icon" data-delete-user="${u.id}" title="Delete" ${u.id === me.id ? 'disabled' : ''} style="color:var(--danger);"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('[data-toggle-admin]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api(`/api/admin/users/${btn.dataset.toggleAdmin}`, 'PUT', { isAdmin: btn.dataset.val === 'true' });
      toast('Role updated.');
      loadUsers();
    } catch (e) { toast(e.message, true); }
  }));
  body.querySelectorAll('[data-toggle-block]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api(`/api/admin/users/${btn.dataset.toggleBlock}`, 'PUT', { isBlocked: btn.dataset.val === 'true' });
      toast(btn.dataset.val === 'true' ? 'User blocked.' : 'User unblocked.');
      loadUsers();
    } catch (e) { toast(e.message, true); }
  }));
  body.querySelectorAll('[data-delete-user]').forEach(btn => btn.addEventListener('click', async () => {
    const u = allUsers.find(u => u.id === btn.dataset.deleteUser);
    if (!confirm(`Delete "${u ? u.name : 'this user'}"? This can't be undone.`)) return;
    try {
      await api(`/api/admin/users/${btn.dataset.deleteUser}`, 'DELETE');
      toast('User deleted.');
      loadUsers();
    } catch (e) { toast(e.message, true); }
  }));
}
document.getElementById('userSearch').addEventListener('input', renderUsers);

/* ── Init ── */
loadDashboard();
