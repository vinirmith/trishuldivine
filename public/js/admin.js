document.addEventListener('DOMContentLoaded', () => {
  const getSupabaseClient = () => {
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;
    if (!url || !key || url.includes('YOUR_SUPABASE') || key.includes('YOUR_SUPABASE')) return null;
    return window.supabase ? window.supabase.createClient(url, key) : null;
  };

  const client = getSupabaseClient();
  const allowedAdminEmails = Array.isArray(window.ADMIN_ALLOWED_EMAILS)
    ? window.ADMIN_ALLOWED_EMAILS.map((email) => String(email || '').trim().toLowerCase())
    : [];

  const loginSection = document.getElementById('adminLogin');
  const deniedSection = document.getElementById('adminDenied');
  const dashboardSection = document.getElementById('adminDashboard');
  const loginForm = document.getElementById('adminLoginForm');
  const loginMessage = document.getElementById('adminLoginMessage');
  const logoutButton = document.getElementById('adminLogoutButton');
  const deniedLogoutButton = document.getElementById('adminDeniedLogout');

  const searchInput = document.getElementById('adminSearch');
  const categoryFilter = document.getElementById('adminCategoryFilter');
  const stockFilter = document.getElementById('adminStockFilter');
  const addButton = document.getElementById('adminAddButton');
  const listBody = document.getElementById('adminProductList');
  const listStatus = document.getElementById('adminListStatus');
  const categoryOptions = document.getElementById('adminCategoryOptions');

  const formOverlay = document.getElementById('adminFormOverlay');
  const productForm = document.getElementById('adminProductForm');
  const formTitle = document.getElementById('adminFormTitle');
  const formClose = document.getElementById('adminFormClose');
  const formCancel = document.getElementById('adminFormCancel');
  const formMessage = document.getElementById('adminFormMessage');
  const fieldId = document.getElementById('adminProductId');
  const fieldName = document.getElementById('fieldName');
  const fieldPrice = document.getElementById('fieldPrice');
  const fieldCategory = document.getElementById('fieldCategory');
  const fieldDescription = document.getElementById('fieldDescription');

  // Descriptions use light markup: **bold** and "- " bullet lines (rendered on the product page).
  document.getElementById('descBold').addEventListener('click', () => {
    const { selectionStart: start, selectionEnd: end, value } = fieldDescription;
    const selected = value.slice(start, end) || 'bold text';
    fieldDescription.setRangeText(`**${selected}**`, start, end, 'select');
    fieldDescription.focus();
  });
  document.getElementById('descBullet').addEventListener('click', () => {
    const { selectionStart, selectionEnd, value } = fieldDescription;
    const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const nextBreak = value.indexOf('\n', selectionEnd);
    const end = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(start, end).split('\n');
    const allBulleted = lines.every((line) => /^\s*-\s/.test(line));
    const next = lines.map((line) => (allBulleted ? line.replace(/^\s*-\s/, '') : (/^\s*-\s/.test(line) ? line : `- ${line}`))).join('\n');
    fieldDescription.setRangeText(next, start, end, 'select');
    fieldDescription.focus();
  });
  const sizeEditor = document.getElementById('sizeEditor');
  const sizeAddButton = document.getElementById('sizeAdd');
  const fieldImageFiles = document.getElementById('fieldImageFiles');
  const imagePreview = document.getElementById('adminImagePreview');
  const fieldInStock = document.getElementById('fieldInStock');
  const fieldInStockLabel = document.getElementById('fieldInStockLabel');

  if (!client) {
    if (loginMessage) loginMessage.textContent = 'Supabase is not configured. Add your project URL and anon key in js/supabase-config.js.';
  }

  let allProducts = [];
  let currentImages = []; // URLs already saved, kept unless removed in the form
  let newImageFiles = []; // File objects staged for upload on save

  const inr = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

  // A size's own price from size_prices, or the product's base price when it has none.
  const sizePrice = (product, size) => {
    const own = Number(product.size_prices?.[size]);
    return own > 0 ? own : Number(product.price) || 0;
  };
  const priceLabel = (product) => {
    const sizes = product.sizes || [];
    const prices = sizes.length ? sizes.map((s) => sizePrice(product, s)) : [Number(product.price) || 0];
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    return low === high ? inr(low) : `${inr(low)} – ${inr(high)}`;
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  const isAllowedAdminEmail = (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    return normalizedEmail && allowedAdminEmails.includes(normalizedEmail);
  };

  const showOnly = (section) => {
    [loginSection, deniedSection, dashboardSection].forEach((el) => {
      if (el) el.hidden = el !== section;
    });
    if (logoutButton) logoutButton.hidden = section !== dashboardSection;
    if (section === dashboardSection) startOrdersPolling();
    else stopOrdersPolling();
  };

  const populateCategoryOptions = () => {
    const categories = Array.from(new Set(allProducts.map((p) => p.category).filter(Boolean))).sort();
    const defaults = ['bracelets', 'rudraksha', 'mala'];
    const merged = Array.from(new Set([...defaults, ...categories]));

    categoryFilter.innerHTML = '<option value="">All categories</option>' +
      merged.map((c) => `<option value="${c}">${c}</option>`).join('');
    categoryOptions.innerHTML = merged.map((c) => `<option value="${c}"></option>`).join('');
  };

  const renderList = () => {
    const query = (searchInput.value || '').trim().toLowerCase();
    const category = categoryFilter.value;
    const stock = stockFilter.value;

    const filtered = allProducts.filter((p) => {
      if (query && !p.name.toLowerCase().includes(query)) return false;
      if (category && p.category !== category) return false;
      if (stock === 'in' && !p.in_stock) return false;
      if (stock === 'out' && p.in_stock) return false;
      return true;
    });

    listStatus.textContent = `${filtered.length} product${filtered.length === 1 ? '' : 's'}`;

    if (!filtered.length) {
      listBody.innerHTML = '<tr><td colspan="7" class="admin-empty-row">No products match these filters.</td></tr>';
      return;
    }

    listBody.innerHTML = filtered.map((p) => {
      const thumb = (p.images && p.images[0]) || 'images/gemstone_beads.jpeg';
      const sizes = (p.sizes && p.sizes.length) ? p.sizes.map((s) => `${s} ${inr(sizePrice(p, s))}`).join(', ') : '—';
      return `
        <tr data-id="${p.id}">
          <td><img class="admin-thumb" src="${escapeHtml(thumb)}" alt="${escapeHtml(p.name)}"></td>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.category)}</td>
          <td>${priceLabel(p)}</td>
          <td>${escapeHtml(sizes)}</td>
          <td>
            <label class="switch">
              <input type="checkbox" class="admin-stock-toggle" data-id="${p.id}" ${p.in_stock ? 'checked' : ''}>
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
            <span class="admin-stock-label">${p.in_stock ? 'In stock' : 'Out of stock'}</span>
          </td>
          <td class="admin-row-actions">
            <button type="button" class="text-button admin-edit-btn" data-id="${p.id}">Edit</button>
            <button type="button" class="text-button admin-delete-btn" data-id="${p.id}">Delete</button>
          </td>
        </tr>
      `;
    }).join('');
  };

  const loadProducts = async () => {
    listStatus.textContent = 'Loading…';
    const { data, error } = await client.from('products').select('*').order('created_at', { ascending: false });
    if (error) {
      listStatus.textContent = 'Could not load products.';
      console.error('Load products failed:', error);
      return;
    }
    allProducts = data || [];
    populateCategoryOptions();
    renderList();
  };

  const renderImagePreview = () => {
    const savedThumbs = currentImages.map((url, index) => `
      <div class="admin-image-chip" data-kind="saved" data-index="${index}">
        <img src="${url}" alt="Product image">
        <button type="button" class="admin-image-remove" data-kind="saved" data-index="${index}" aria-label="Remove image">×</button>
      </div>
    `);
    const newThumbs = newImageFiles.map((file, index) => `
      <div class="admin-image-chip" data-kind="new" data-index="${index}">
        <img src="${URL.createObjectURL(file)}" alt="New image">
        <button type="button" class="admin-image-remove" data-kind="new" data-index="${index}" aria-label="Remove image">×</button>
      </div>
    `);
    imagePreview.innerHTML = savedThumbs.join('') + newThumbs.join('');
  };

  // Sizes & prices: preset sizes are ticked on/off, extra sizes are added with "+ Add size".
  const PRESET_SIZES = ['6mm', '8mm', 'Free size'];

  const sizeRowHtml = (name, price, { preset = false, checked = true } = {}) => `
    <div class="size-row" ${preset ? `data-size="${escapeHtml(name)}"` : ''}>
      ${preset
        ? `<label class="size-check"><input type="checkbox" class="size-enabled" ${checked ? 'checked' : ''}><span>${escapeHtml(name)}</span></label>`
        : '<input type="text" class="size-name" placeholder="Size, e.g. 10mm" maxlength="40">'}
      <label class="size-price-wrap" ${checked ? '' : 'hidden'}>₹<input type="number" class="size-price" min="0" step="0.01" placeholder="Price" value="${price > 0 ? price : ''}" aria-label="Price for this size"></label>
      ${preset ? '' : '<button type="button" class="size-remove" aria-label="Remove size">×</button>'}
    </div>`;

  const renderSizeEditor = (sizes = [], prices = {}) => {
    const priceOf = (size) => Number(prices?.[size]) || 0;
    const custom = sizes.filter((size) => !PRESET_SIZES.includes(size));
    sizeEditor.innerHTML = PRESET_SIZES.map((size) => sizeRowHtml(size, priceOf(size), { preset: true, checked: sizes.includes(size) })).join('')
      + custom.map((size) => sizeRowHtml(size, priceOf(size))).join('');
    // Custom names are set as values (not markup) so any characters are kept exactly.
    sizeEditor.querySelectorAll('.size-name').forEach((input, i) => { input.value = custom[i]; });
  };

  const readSizeEditor = () => {
    const sizes = [];
    const sizePrices = {};
    sizeEditor.querySelectorAll('.size-row').forEach((row) => {
      const enabled = row.querySelector('.size-enabled');
      if (enabled && !enabled.checked) return;
      const name = (enabled ? row.dataset.size : row.querySelector('.size-name').value).replace(/\s+/g, ' ').trim();
      if (!name) return;
      if (sizes.includes(name)) throw new Error(`The size "${name}" is listed twice.`);
      sizes.push(name);
      const price = Number(row.querySelector('.size-price').value);
      if (price > 0) sizePrices[name] = price;
    });
    return { sizes, sizePrices };
  };

  // When a size is switched on, ask for its price, starting from the base price.
  const askSizePrice = (row) => {
    const input = row.querySelector('.size-price');
    if (!input.value && Number(fieldPrice.value) > 0) input.value = fieldPrice.value;
    input.focus();
    input.select();
  };

  const resetForm = () => {
    productForm.reset();
    fieldId.value = '';
    currentImages = [];
    newImageFiles = [];
    formMessage.textContent = '';
    fieldInStock.checked = true;
    fieldInStockLabel.textContent = 'In stock';
    renderSizeEditor();
    renderImagePreview();
  };

  const openForm = (product) => {
    resetForm();
    if (product) {
      formTitle.textContent = 'Edit product';
      fieldId.value = product.id;
      fieldName.value = product.name || '';
      fieldPrice.value = product.price || 0;
      fieldCategory.value = product.category || '';
      fieldDescription.value = product.description || '';
      renderSizeEditor(product.sizes || [], product.size_prices || {});
      fieldInStock.checked = !!product.in_stock;
      fieldInStockLabel.textContent = product.in_stock ? 'In stock' : 'Out of stock';
      currentImages = [...(product.images || [])];
      renderImagePreview();
    } else {
      formTitle.textContent = 'Add product';
    }
    formOverlay.hidden = false;
    document.body.classList.add('cart-open');
  };

  const closeForm = () => {
    formOverlay.hidden = true;
    document.body.classList.remove('cart-open');
  };

  const MAX_IMAGE_SIDE = 1200;
  const IMAGE_QUALITY = 0.82;

  // Shrinks big photos in the browser before upload. Falls back to the original
  // file if the browser can't decode it (e.g. HEIC) or the result isn't smaller.
  const resizeImage = async (file) => {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY));
      if (!blob || blob.size >= file.size) return file;
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg' });
    } catch (err) {
      console.warn('Could not resize image, uploading original:', err);
      return file;
    }
  };

  const uploadStagedImages = async () => {
    const uploaded = [];
    for (const original of newImageFiles) {
      formMessage.textContent = 'Optimising images…';
      const file = await resizeImage(original);
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const path = `${crypto.randomUUID()}-${safeName}`;
      const { error } = await client.storage.from('product-images').upload(path, file, { cacheControl: '31536000', upsert: false });
      if (error) throw error;
      const { data } = client.storage.from('product-images').getPublicUrl(path);
      uploaded.push(data.publicUrl);
    }
    return uploaded;
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    formMessage.textContent = 'Saving…';
    const saveButton = document.getElementById('adminFormSave');
    saveButton.disabled = true;

    try {
      const { sizes, sizePrices } = readSizeEditor();
      // With no base price, the cheapest size price stands in for it (shown on cards as "From ₹…").
      const ownPrices = Object.values(sizePrices);
      const price = Number(fieldPrice.value) || (ownPrices.length ? Math.min(...ownPrices) : 0);
      if (!fieldName.value.trim() || !fieldCategory.value.trim()) {
        formMessage.textContent = 'Name and category are required.';
        return;
      }
      if (!(Number(fieldPrice.value) > 0) && (!sizes.length || sizes.some((size) => !sizePrices[size]))) {
        formMessage.textContent = 'Enter a base price, or a price for every size.';
        return;
      }

      const uploadedUrls = await uploadStagedImages();
      const images = [...currentImages, ...uploadedUrls];

      const payload = {
        name: fieldName.value.trim(),
        price,
        category: fieldCategory.value.trim().toLowerCase(),
        description: fieldDescription.value.trim(),
        sizes,
        size_prices: sizePrices,
        images,
        in_stock: fieldInStock.checked,
      };

      const editingId = fieldId.value;
      const { error } = editingId
        ? await client.from('products').update(payload).eq('id', editingId)
        : await client.from('products').insert([payload]);

      if (error) throw error;

      closeForm();
      await loadProducts();
    } catch (error) {
      console.error('Save product failed:', error);
      formMessage.textContent = error.message || 'Could not save this product.';
    } finally {
      saveButton.disabled = false;
    }
  };

  const deleteProduct = async (id) => {
    if (!confirm('Delete this product? This cannot be undone.')) return;
    const { error } = await client.from('products').delete().eq('id', id);
    if (error) {
      alert(error.message || 'Could not delete this product.');
      return;
    }
    await loadProducts();
  };

  const toggleStock = async (id, checked) => {
    const { error } = await client.from('products').update({ in_stock: checked }).eq('id', id);
    if (error) {
      alert(error.message || 'Could not update availability.');
      await loadProducts();
      return;
    }
    const product = allProducts.find((p) => p.id === id);
    if (product) product.in_stock = checked;
    renderList();
  };

  const checkAccess = async () => {
    if (!client) {
      showOnly(loginSection);
      return;
    }

    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      showOnly(loginSection);
      return;
    }

    const signedInEmail = (session.user?.email || '').trim().toLowerCase();
    const emailAllowed = isAllowedAdminEmail(signedInEmail);

    if (emailAllowed) {
      showOnly(dashboardSection);
      await loadProducts();
      return;
    }

    const { data: isAdmin, error } = await client.rpc('is_admin');
    if (error) {
      console.error('is_admin check failed:', error);
      showOnly(deniedSection);
      return;
    }

    if (isAdmin) {
      showOnly(dashboardSection);
      await loadProducts();
    } else {
      showOnly(deniedSection);
    }
  };

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = loginForm.querySelector('[name="email"]').value.trim();
    const password = loginForm.querySelector('[name="password"]').value;
    loginMessage.textContent = 'Signing in…';

    if (!client) {
      loginMessage.textContent = 'Supabase is not configured. Add your project URL and anon key in js/supabase-config.js.';
      return;
    }

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      loginMessage.textContent = error.message || 'Login failed.';
      return;
    }

    const signedInEmail = email.trim().toLowerCase();
    if (!isAllowedAdminEmail(signedInEmail)) {
      const { error: signOutError } = await client.auth.signOut();
      if (signOutError) console.error('Admin sign-out after deny failed:', signOutError);
      loginMessage.textContent = 'This account is not in the approved admin allowlist.';
      showOnly(deniedSection);
      return;
    }

    loginMessage.textContent = '';
    await checkAccess();
  });

  const doLogout = async () => {
    if (client) {
      await client.auth.signOut();
    }
    await checkAccess();
  };
  logoutButton.addEventListener('click', doLogout);
  deniedLogoutButton.addEventListener('click', doLogout);

  searchInput.addEventListener('input', renderList);
  categoryFilter.addEventListener('change', renderList);
  stockFilter.addEventListener('change', renderList);

  addButton.addEventListener('click', () => openForm(null));
  formClose.addEventListener('click', closeForm);
  formCancel.addEventListener('click', closeForm);
  formOverlay.addEventListener('click', (event) => {
    if (event.target === formOverlay) closeForm();
  });

  sizeEditor.addEventListener('change', (event) => {
    const toggle = event.target.closest('.size-enabled');
    if (!toggle) return;
    const row = toggle.closest('.size-row');
    row.querySelector('.size-price-wrap').hidden = !toggle.checked;
    if (toggle.checked) askSizePrice(row);
  });

  sizeEditor.addEventListener('click', (event) => {
    const remove = event.target.closest('.size-remove');
    if (remove) remove.closest('.size-row').remove();
  });

  sizeAddButton.addEventListener('click', () => {
    sizeEditor.insertAdjacentHTML('beforeend', sizeRowHtml('', 0));
    const row = sizeEditor.lastElementChild;
    if (Number(fieldPrice.value) > 0) row.querySelector('.size-price').value = fieldPrice.value;
    row.querySelector('.size-name').focus();
  });

  fieldInStock.addEventListener('change', () => {
    fieldInStockLabel.textContent = fieldInStock.checked ? 'In stock' : 'Out of stock';
  });

  fieldImageFiles.addEventListener('change', () => {
    newImageFiles = newImageFiles.concat(Array.from(fieldImageFiles.files || []));
    fieldImageFiles.value = '';
    renderImagePreview();
  });

  imagePreview.addEventListener('click', (event) => {
    const button = event.target.closest('.admin-image-remove');
    if (!button) return;
    const index = Number(button.dataset.index);
    if (button.dataset.kind === 'saved') {
      currentImages.splice(index, 1);
    } else {
      newImageFiles.splice(index, 1);
    }
    renderImagePreview();
  });

  productForm.addEventListener('submit', saveProduct);

  listBody.addEventListener('click', (event) => {
    const editButton = event.target.closest('.admin-edit-btn');
    if (editButton) {
      const product = allProducts.find((p) => p.id === editButton.dataset.id);
      if (product) openForm(product);
      return;
    }
    const deleteButton = event.target.closest('.admin-delete-btn');
    if (deleteButton) {
      deleteProduct(deleteButton.dataset.id);
    }
  });

  listBody.addEventListener('change', (event) => {
    const toggle = event.target.closest('.admin-stock-toggle');
    if (toggle) {
      toggleStock(toggle.dataset.id, toggle.checked);
    }
  });

  

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------
  const tabButtons = document.querySelectorAll('.admin-tab');
  const productsPane = document.getElementById('adminProductsPane');
  const ordersPane = document.getElementById('adminOrdersPane');
  const ordersBadge = document.getElementById('adminOrdersBadge');
  const orderSearch = document.getElementById('orderSearch');
  const orderPaymentFilter = document.getElementById('orderPaymentFilter');
  const ordersRefresh = document.getElementById('ordersRefresh');
  const ordersStatus = document.getElementById('ordersStatus');
  const orderList = document.getElementById('adminOrderList');
  const orderOverlay = document.getElementById('adminOrderOverlay');
  const orderDetailTitle = document.getElementById('orderDetailTitle');
  const orderDetailBody = document.getElementById('orderDetailBody');
  const orderDetailClose = document.getElementById('orderDetailClose');

  const ORDERS_SEEN_KEY = 'trishul_admin_orders_seen';
  const ORDERS_POLL_MS = 30000;
  let activeTab = 'products';
  let allOrders = [];
  const orderItemsById = new Map();
  let ordersTimer = null;
  let ordersLoading = false;
  let ordersLoadedAt = null;
  let dbAdmin = null;
  let openOrderId = null;

  const readSeen = () => { try { return localStorage.getItem(ORDERS_SEEN_KEY) || ''; } catch (err) { return ''; } };
  const writeSeen = (value) => { try { localStorage.setItem(ORDERS_SEEN_KEY, value); } catch (err) { /* private mode */ } };

  const formatDate = (iso) => (iso
    ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—');

  const PAYMENT_BADGES = {
    paid: ['Paid', 'is-good'],
    created: ['Awaiting payment', 'is-muted'],
    failed: ['Failed', 'is-bad'],
    partially_refunded: ['Part refunded', 'is-warn'],
    refunded: ['Refunded', 'is-warn'],
  };
  const paymentBadge = (status) => {
    const [label, cls] = PAYMENT_BADGES[status] || [status || '—', 'is-muted'];
    return `<span class="admin-pill ${cls}">${escapeHtml(label)}</span>`;
  };
  const isPaidLike = (order) => ['paid', 'partially_refunded', 'refunded'].includes(order.payment_status);
  const emailBadge = (order) => {
    if (!isPaidLike(order)) return '<span class="admin-pill is-muted">—</span>';
    if (order.confirmation_email_status === 'sent') return '<span class="admin-pill is-good">Sent</span>';
    if (order.confirmation_email_status === 'failed') return '<span class="admin-pill is-bad">Failed</span>';
    return '<span class="admin-pill is-muted">Sending</span>';
  };

  // Shipping: first whether the paid order reached Shiprocket, then what tracking says.
  const shippingBadge = (order) => {
    if (order.payment_status !== 'paid') return '<span class="admin-pill is-muted">—</span>';
    if (order.delivered_at) return '<span class="admin-pill is-good">Delivered</span>';
    if (order.shipped_at) return `<span class="admin-pill is-good">${escapeHtml(order.tracking_status || 'Shipped')}</span>`;
    if (order.shiprocket_push_status === 'sent') return `<span class="admin-pill is-warn">${escapeHtml(order.tracking_status || 'Ready to ship')}</span>`;
    if (order.shiprocket_push_status === 'failed') return '<span class="admin-pill is-bad">Not in Shiprocket</span>';
    return '<span class="admin-pill is-muted">Not sent</span>';
  };

  const itemsSummary = (orderId) => {
    const items = orderItemsById.get(orderId) || [];
    if (!items.length) return '—';
    const shown = items.slice(0, 2).map((item) => `${item.quantity}× ${escapeHtml(item.product_name)}${item.size ? ` (${escapeHtml(item.size)})` : ''}`);
    if (items.length > 2) shown.push(`+${items.length - 2} more`);
    return shown.join('<br>');
  };

  const orderMatches = (order, query) => {
    if (!query) return true;
    const details = order.shipping_details || {};
    return [order.order_number, details.full_name, details.phone, details.email, order.razorpay_order_id]
      .some((value) => String(value || '').toLowerCase().includes(query));
  };

  const renderOrders = () => {
    const query = (orderSearch.value || '').trim().toLowerCase();
    const rows = allOrders.filter((order) => orderMatches(order, query));
    const stamp = ordersLoadedAt ? ` · updated ${ordersLoadedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : '';
    const limited = allOrders.length >= 300 ? ' (latest 300)' : '';
    ordersStatus.textContent = `${rows.length} order${rows.length === 1 ? '' : 's'}${limited}${stamp}`;

    if (!rows.length) {
      orderList.innerHTML = '<tr><td colspan="9" class="admin-empty-row">No orders match these filters.</td></tr>';
      return;
    }

    orderList.innerHTML = rows.map((order) => {
      const details = order.shipping_details || {};
      return `
        <tr class="admin-order-row" data-id="${escapeHtml(order.id)}">
          <td><strong>${escapeHtml(order.order_number || '—')}</strong></td>
          <td>${escapeHtml(formatDate(order.paid_at || order.created_at))}</td>
          <td>${escapeHtml(details.full_name || '—')}<br><span class="admin-muted">${escapeHtml(details.phone || '')}</span></td>
          <td>${itemsSummary(order.id)}</td>
          <td>${inr(order.total_amount)}</td>
          <td>${paymentBadge(order.payment_status)}</td>
          <td>${shippingBadge(order)}</td>
          <td>${emailBadge(order)}</td>
          <td class="admin-row-actions"><button type="button" class="text-button admin-order-view" data-id="${escapeHtml(order.id)}">View</button></td>
        </tr>`;
    }).join('');
  };

  const markOrdersSeen = async () => {
    const { data } = await client.from('orders').select('paid_at').eq('payment_status', 'paid')
      .order('paid_at', { ascending: false }).limit(1);
    if (data && data[0] && data[0].paid_at) writeSeen(data[0].paid_at);
    ordersBadge.hidden = true;
  };

  const refreshBadge = async () => {
    if (activeTab === 'orders') { ordersBadge.hidden = true; return; }
    const seen = readSeen();
    let query = client.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'paid');
    if (seen) query = query.gt('paid_at', seen);
    const { count, error } = await query;
    if (error) return;
    ordersBadge.textContent = count > 99 ? '99+' : String(count || 0);
    ordersBadge.hidden = !count;
  };

  const loadOrders = async ({ silent = false } = {}) => {
    if (ordersLoading) return;
    ordersLoading = true;
    if (!silent) ordersStatus.textContent = 'Loading…';
    try {
      if (dbAdmin === null) {
        const { data } = await client.rpc('is_admin');
        dbAdmin = !!data;
      }
      if (!dbAdmin) {
        allOrders = [];
        orderList.innerHTML = '<tr><td colspan="9" class="admin-empty-row">This login is not an admin in the database, so orders cannot be shown. Add this email with supabase/admin-setup.sql.</td></tr>';
        ordersStatus.textContent = '';
        return;
      }

      let query = client.from('orders').select('*').order('created_at', { ascending: false }).limit(300);
      const filter = orderPaymentFilter.value;
      if (filter === 'refunded') query = query.in('payment_status', ['refunded', 'partially_refunded']);
      else if (filter !== 'all') query = query.eq('payment_status', filter);
      const { data, error } = await query;
      if (error) throw error;
      allOrders = data || [];

      const missing = allOrders.map((order) => order.id).filter((id) => !orderItemsById.has(id));
      for (let i = 0; i < missing.length; i += 40) {
        const chunk = missing.slice(i, i + 40);
        const { data: items, error: itemsError } = await client.from('order_items').select('*').in('order_id', chunk);
        if (itemsError) throw itemsError;
        chunk.forEach((id) => orderItemsById.set(id, []));
        (items || []).forEach((item) => orderItemsById.get(item.order_id).push(item));
      }

      ordersLoadedAt = new Date();
      renderOrders();
      if (activeTab === 'orders') await markOrdersSeen();
    } catch (err) {
      console.error('Load orders failed:', err);
      ordersStatus.textContent = 'Could not load orders. Check your connection and press Refresh.';
    } finally {
      ordersLoading = false;
    }
  };

  const setTab = (tab) => {
    activeTab = tab;
    tabButtons.forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    productsPane.hidden = tab !== 'products';
    ordersPane.hidden = tab !== 'orders';
    discountsPane.hidden = tab !== 'discounts';
    if (tab === 'orders') loadOrders();
    else refreshBadge();
    if (tab === 'discounts') loadDiscounts();
  };

  const stopOrdersPolling = () => {
    if (ordersTimer) clearInterval(ordersTimer);
    ordersTimer = null;
    dbAdmin = null;
    allOrders = [];
    orderItemsById.clear();
    ordersBadge.hidden = true;
    activeTab = 'products';
    if (orderOverlay) orderOverlay.hidden = true;
  };

  const startOrdersPolling = () => {
    if (ordersTimer || !client) return;
    setTab('products');
    refreshBadge();
    ordersTimer = setInterval(() => {
      if (document.hidden) return;
      if (activeTab === 'orders') loadOrders({ silent: true });
      else refreshBadge();
    }, ORDERS_POLL_MS);
  };

  const detailRow = (label, value) => `<div class="admin-detail-row"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;

  const closeOrderDetail = () => {
    orderOverlay.hidden = true;
    openOrderId = null;
    if (formOverlay.hidden) document.body.classList.remove('cart-open');
  };

  const openOrderDetail = async (id) => {
    const order = allOrders.find((o) => o.id === id);
    if (!order) return;
    openOrderId = id;
    const details = order.shipping_details || {};
    orderDetailTitle.textContent = order.order_number ? `Order ${order.order_number}` : 'Order';
    orderDetailBody.innerHTML = '<p class="admin-muted">Loading…</p>';
    orderOverlay.hidden = false;
    document.body.classList.add('cart-open');

    const [paymentsResult, refundsResult] = await Promise.all([
      client.from('payments').select('*').eq('order_id', id).order('created_at', { ascending: true }),
      client.from('refunds').select('*').eq('order_id', id).order('created_at', { ascending: true }),
    ]);
    if (openOrderId !== id) return;

    const items = orderItemsById.get(id) || [];
    const payments = paymentsResult.data || [];
    const refunds = refundsResult.data || [];
    const phone = String(details.phone || '').replace(/\D/g, '');
    const addressText = [details.full_name, details.address, `${details.city || ''}, ${details.state || ''} ${details.pincode || ''}`.trim(), details.country, details.phone ? `Phone: ${details.phone}` : '']
      .filter(Boolean).join('\n');

    orderDetailBody.innerHTML = `
      <div class="admin-detail-top">
        ${paymentBadge(order.payment_status)}
        <span class="admin-muted">Placed ${escapeHtml(formatDate(order.created_at))}${order.paid_at ? ` · Paid ${escapeHtml(formatDate(order.paid_at))}` : ''}</span>
      </div>

      <h4 class="admin-detail-heading">Customer</h4>
      <dl class="admin-detail-list">
        ${detailRow('Name', escapeHtml(details.full_name || '—'))}
        ${detailRow('Phone', phone ? `<a href="tel:+91${escapeHtml(phone)}">${escapeHtml(details.phone)}</a> · <a href="https://wa.me/91${escapeHtml(phone)}" target="_blank" rel="noopener">WhatsApp</a>` : '—')}
        ${detailRow('Email', details.email ? `<a href="mailto:${escapeHtml(details.email)}">${escapeHtml(details.email)}</a>` : '—')}
        ${detailRow('Account', order.user_id ? 'Signed-in customer' : 'Guest checkout')}
      </dl>

      <h4 class="admin-detail-heading">Ship to <button type="button" class="text-button admin-copy-address">Copy address</button></h4>
      <p class="admin-detail-address">${escapeHtml(addressText).replace(/\n/g, '<br>') || escapeHtml(order.shipping_address || '—')}</p>
      ${order.notes ? `<h4 class="admin-detail-heading">Customer note</h4><p class="admin-detail-address">${escapeHtml(order.notes)}</p>` : ''}

      <h4 class="admin-detail-heading">Items</h4>
      <table class="admin-detail-items">
        ${items.map((item) => `<tr><td>${escapeHtml(item.product_name)}${item.size ? ` <span class="admin-muted">(${escapeHtml(item.size)})</span>` : ''}</td><td>${escapeHtml(item.quantity)} × ${inr(item.unit_price)}</td><td class="num">${inr(Number(item.unit_price) * Number(item.quantity))}</td></tr>`).join('') || '<tr><td colspan="3" class="admin-muted">No items.</td></tr>'}
        ${Number(order.discount_amount) > 0 ? `<tr class="total"><td colspan="2">Discount (${escapeHtml(order.discount_code)})</td><td class="num">−${inr(order.discount_amount)}</td></tr>` : ''}
        <tr class="total"><td colspan="2">Shipping</td><td class="num">${Number(order.shipping_fee) > 0 ? inr(order.shipping_fee) : 'Free'}</td></tr>
        <tr class="total"><td colspan="2"><strong>Total</strong></td><td class="num"><strong>${inr(order.total_amount)}</strong></td></tr>
      </table>

      ${order.payment_status === 'paid' ? `
        <h4 class="admin-detail-heading">Shipping</h4>
        <dl class="admin-detail-list">
          ${detailRow('Status', shippingBadge(order))}
          ${order.courier_name ? detailRow('Courier', escapeHtml(order.courier_name)) : ''}
          ${order.awb_code ? detailRow('AWB', `<a href="https://shiprocket.co/tracking/${encodeURIComponent(order.awb_code)}" target="_blank" rel="noopener">${escapeHtml(order.awb_code)}</a>`) : ''}
          ${order.expected_delivery ? detailRow('Expected', escapeHtml(order.expected_delivery)) : ''}
          ${order.shipped_at ? detailRow('Shipped', escapeHtml(formatDate(order.shipped_at))) : ''}
          ${order.delivered_at ? detailRow('Delivered', escapeHtml(formatDate(order.delivered_at))) : ''}
          ${order.shiprocket_order_id ? detailRow('Shiprocket', `Order ${escapeHtml(order.shiprocket_order_id)} · <a href="https://app.shiprocket.in/seller/orders/new" target="_blank" rel="noopener">Open Shiprocket</a>`) : ''}
          ${order.shiprocket_error ? detailRow('Last error', `<span class="admin-muted">${escapeHtml(order.shiprocket_error)}</span>`) : ''}
        </dl>
        ${['pending', 'failed'].includes(order.shiprocket_push_status || 'pending') ? `
          <button type="button" class="button button-secondary admin-push-shiprocket">${order.shiprocket_push_status === 'failed' ? 'Retry sending to Shiprocket' : 'Send to Shiprocket'}</button>
          <p id="orderShipMessage" class="auth-message" aria-live="polite"></p>` : ''}` : ''}

      <h4 class="admin-detail-heading">Payments</h4>
      ${payments.length ? payments.map((p) => `
        <div class="admin-detail-payment">
          <div>${paymentBadge(p.status === 'captured' ? 'paid' : p.status)} ${escapeHtml(inr(p.amount))}${p.method ? ` · ${escapeHtml(p.method)}` : ''}</div>
          <div class="admin-muted">${escapeHtml(p.razorpay_payment_id)} · ${escapeHtml(formatDate(p.paid_at || p.created_at))}</div>
          ${p.error_description ? `<div class="admin-muted">${escapeHtml(p.error_description)}</div>` : ''}
        </div>`).join('') : '<p class="admin-muted">No payment attempts yet.</p>'}
      ${refunds.length ? `<h4 class="admin-detail-heading">Refunds</h4>${refunds.map((r) => `<div class="admin-detail-payment"><div>${escapeHtml(inr(r.amount))} · ${escapeHtml(r.status)}</div><div class="admin-muted">${escapeHtml(r.razorpay_refund_id)} · ${escapeHtml(formatDate(r.created_at))}</div></div>`).join('')}` : ''}

      ${isPaidLike(order) ? `
        <h4 class="admin-detail-heading">Confirmation email</h4>
        <p>${emailBadge(order)} <span class="admin-muted">${order.confirmation_email_sent_at ? escapeHtml(formatDate(order.confirmation_email_sent_at)) : ''}</span></p>
        ${order.confirmation_email_error ? `<p class="admin-muted">Last error: ${escapeHtml(order.confirmation_email_error)}</p>` : ''}
        <button type="button" class="button button-secondary admin-resend-email">${order.confirmation_email_status === 'sent' ? 'Resend confirmation email' : 'Send confirmation email'}</button>
        <p id="orderDetailMessage" class="auth-message" aria-live="polite"></p>` : ''}
    `;

    orderDetailBody.querySelector('.admin-copy-address')?.addEventListener('click', async (event) => {
      try {
        await navigator.clipboard.writeText(addressText);
        event.target.textContent = 'Copied';
      } catch (err) {
        event.target.textContent = 'Copy failed';
      }
    });

    orderDetailBody.querySelector('.admin-push-shiprocket')?.addEventListener('click', async (event) => {
      const button = event.target;
      const message = document.getElementById('orderShipMessage');
      button.disabled = true;
      message.textContent = 'Sending to Shiprocket…';
      try {
        const { data: { session } } = await client.auth.getSession();
        const response = await fetch('/shipping/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({ order_id: id }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || 'Could not send this order to Shiprocket.');
        await loadOrders({ silent: true });
        if (openOrderId === id) openOrderDetail(id);
      } catch (err) {
        message.textContent = err.message || 'Could not send this order to Shiprocket.';
        button.disabled = false;
      }
    });

    orderDetailBody.querySelector('.admin-resend-email')?.addEventListener('click', async (event) => {
      const button = event.target;
      const message = document.getElementById('orderDetailMessage');
      button.disabled = true;
      message.textContent = 'Sending…';
      try {
        const { data: { session } } = await client.auth.getSession();
        const response = await fetch('/payments/resend-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({ order_id: id }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || 'Could not send the email.');
        await loadOrders({ silent: true });
        if (openOrderId === id) openOrderDetail(id);
      } catch (err) {
        message.textContent = err.message || 'Could not send the email.';
        button.disabled = false;
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Discount codes (checked and applied by the server at checkout)
  // ---------------------------------------------------------------------------
  const discountsPane = document.getElementById('adminDiscountsPane');
  const discountForm = document.getElementById('discountForm');
  const discountId = document.getElementById('discountId');
  const discountCode = document.getElementById('discountCode');
  const discountType = document.getElementById('discountType');
  const discountValue = document.getElementById('discountValue');
  const discountMinOrder = document.getElementById('discountMinOrder');
  const discountMaxUses = document.getElementById('discountMaxUses');
  const discountExpires = document.getElementById('discountExpires');
  const discountSave = document.getElementById('discountSave');
  const discountCancel = document.getElementById('discountCancel');
  const discountMessage = document.getElementById('discountMessage');
  const discountStatus = document.getElementById('discountStatus');
  const discountList = document.getElementById('discountList');
  let allDiscounts = [];

  const discountLabel = (d) => (d.discount_type === 'percent' ? `${Number(d.value)}% off` : `${inr(d.value)} off`);
  const formatDay = (iso) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
  const isoDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // yyyy-mm-dd for <input type="date">

  const renderDiscounts = () => {
    discountStatus.textContent = `${allDiscounts.length} code${allDiscounts.length === 1 ? '' : 's'}`;
    if (!allDiscounts.length) {
      discountList.innerHTML = '<tr><td colspan="7" class="admin-empty-row">No discount codes yet. Add one above.</td></tr>';
      return;
    }
    discountList.innerHTML = allDiscounts.map((d) => {
      const expired = d.expires_at && new Date(d.expires_at) <= new Date();
      const usedUp = d.max_uses && d.used_count >= d.max_uses;
      return `
        <tr>
          <td><strong>${escapeHtml(d.code)}</strong></td>
          <td>${escapeHtml(discountLabel(d))}</td>
          <td>${Number(d.min_order_amount) > 0 ? inr(d.min_order_amount) : '—'}</td>
          <td>${escapeHtml(d.used_count)}${d.max_uses ? ` / ${escapeHtml(d.max_uses)}` : ''}${usedUp ? ' <span class="admin-pill is-warn">Used up</span>' : ''}</td>
          <td>${d.expires_at ? escapeHtml(formatDay(d.expires_at)) : 'Never'}${expired ? ' <span class="admin-pill is-bad">Expired</span>' : ''}</td>
          <td>
            <label class="switch">
              <input type="checkbox" class="discount-toggle" data-id="${escapeHtml(d.id)}" ${d.active ? 'checked' : ''}>
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </td>
          <td class="admin-row-actions">
            <button type="button" class="text-button discount-edit" data-id="${escapeHtml(d.id)}">Edit</button>
            <button type="button" class="text-button admin-delete-btn discount-delete" data-id="${escapeHtml(d.id)}">Delete</button>
          </td>
        </tr>`;
    }).join('');
  };

  const loadDiscounts = async () => {
    discountStatus.textContent = 'Loading…';
    const { data, error } = await client.from('discount_codes').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('Load discount codes failed:', error);
      discountStatus.textContent = 'Could not load discount codes. Make sure supabase/payments-setup.sql has been run.';
      return;
    }
    allDiscounts = data || [];
    renderDiscounts();
  };

  const resetDiscountForm = () => {
    discountForm.reset();
    discountId.value = '';
    discountSave.textContent = 'Add code';
    discountCancel.hidden = true;
  };

  const editDiscount = (d) => {
    discountId.value = d.id;
    discountCode.value = d.code;
    discountType.value = d.discount_type;
    discountValue.value = Number(d.value);
    discountMinOrder.value = Number(d.min_order_amount) || '';
    discountMaxUses.value = d.max_uses || '';
    discountExpires.value = d.expires_at ? isoDay(d.expires_at) : '';
    discountSave.textContent = 'Save code';
    discountCancel.hidden = false;
    discountMessage.textContent = '';
    discountCode.focus();
  };

  discountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = discountCode.value.replace(/\s+/g, '').toUpperCase();
    const value = Number(discountValue.value);
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) {
      discountMessage.textContent = 'Codes are 3–30 letters or numbers (- and _ allowed), no spaces.';
      return;
    }
    if (!(value > 0) || (discountType.value === 'percent' && value > 100)) {
      discountMessage.textContent = discountType.value === 'percent' ? 'Enter a percentage between 1 and 100.' : 'Enter the amount to take off.';
      return;
    }
    const payload = {
      code,
      discount_type: discountType.value,
      value,
      min_order_amount: Number(discountMinOrder.value) || 0,
      max_uses: Number(discountMaxUses.value) > 0 ? Math.floor(Number(discountMaxUses.value)) : null,
      // The code works until the end of the chosen day, Indian time.
      expires_at: discountExpires.value ? `${discountExpires.value}T23:59:59+05:30` : null,
    };

    discountSave.disabled = true;
    discountMessage.textContent = 'Saving…';
    const { error } = discountId.value
      ? await client.from('discount_codes').update(payload).eq('id', discountId.value)
      : await client.from('discount_codes').insert([payload]);
    discountSave.disabled = false;
    if (error) {
      console.error('Save discount code failed:', error);
      discountMessage.textContent = error.code === '23505' ? `The code ${code} already exists.` : (error.message || 'Could not save this code.');
      return;
    }
    discountMessage.textContent = `${code} saved.`;
    resetDiscountForm();
    await loadDiscounts();
  });

  discountCancel.addEventListener('click', () => {
    resetDiscountForm();
    discountMessage.textContent = '';
  });

  discountList.addEventListener('click', async (event) => {
    const edit = event.target.closest('.discount-edit');
    if (edit) {
      const d = allDiscounts.find((x) => x.id === edit.dataset.id);
      if (d) editDiscount(d);
      return;
    }
    const remove = event.target.closest('.discount-delete');
    if (remove) {
      const d = allDiscounts.find((x) => x.id === remove.dataset.id);
      if (!d || !confirm(`Delete the code ${d.code}? Customers will no longer be able to use it.`)) return;
      const { error } = await client.from('discount_codes').delete().eq('id', d.id);
      if (error) alert(error.message || 'Could not delete this code.');
      if (discountId.value === d.id) resetDiscountForm();
      await loadDiscounts();
    }
  });

  discountList.addEventListener('change', async (event) => {
    const toggle = event.target.closest('.discount-toggle');
    if (!toggle) return;
    const { error } = await client.from('discount_codes').update({ active: toggle.checked }).eq('id', toggle.dataset.id);
    if (error) alert(error.message || 'Could not update this code.');
    await loadDiscounts();
  });

  tabButtons.forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
  orderSearch.addEventListener('input', renderOrders);
  orderPaymentFilter.addEventListener('change', () => loadOrders());
  ordersRefresh.addEventListener('click', () => loadOrders());
  orderDetailClose.addEventListener('click', closeOrderDetail);
  orderOverlay.addEventListener('click', (event) => { if (event.target === orderOverlay) closeOrderDetail(); });
  orderList.addEventListener('click', (event) => {
    const row = event.target.closest('.admin-order-row');
    if (row) openOrderDetail(row.dataset.id);
  });

  checkAccess();
});
