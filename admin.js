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
  const fieldSizes = document.getElementById('fieldSizes');
  const fieldImageFiles = document.getElementById('fieldImageFiles');
  const imagePreview = document.getElementById('adminImagePreview');
  const fieldInStock = document.getElementById('fieldInStock');
  const fieldInStockLabel = document.getElementById('fieldInStockLabel');

  if (!client) {
    if (loginMessage) loginMessage.textContent = 'Supabase is not configured. Add your project URL and anon key in supabase-config.js.';
  }

  let allProducts = [];
  let currentImages = []; // URLs already saved, kept unless removed in the form
  let newImageFiles = []; // File objects staged for upload on save

  const inr = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

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
  };

  const populateCategoryOptions = () => {
    const categories = Array.from(new Set(allProducts.map((p) => p.category).filter(Boolean))).sort();
    const defaults = ['bracelets', 'rudraksha', 'chains'];
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
      const sizes = (p.sizes && p.sizes.length) ? p.sizes.join(', ') : '—';
      return `
        <tr data-id="${p.id}">
          <td><img class="admin-thumb" src="${escapeHtml(thumb)}" alt="${escapeHtml(p.name)}"></td>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.category)}</td>
          <td>${inr(p.price)}</td>
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

  const resetForm = () => {
    productForm.reset();
    fieldId.value = '';
    currentImages = [];
    newImageFiles = [];
    formMessage.textContent = '';
    fieldInStock.checked = true;
    fieldInStockLabel.textContent = 'In stock';
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
      fieldSizes.value = (product.sizes || []).join(', ');
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
      const uploadedUrls = await uploadStagedImages();
      const images = [...currentImages, ...uploadedUrls];

      const payload = {
        name: fieldName.value.trim(),
        price: Number(fieldPrice.value) || 0,
        category: fieldCategory.value.trim().toLowerCase(),
        description: fieldDescription.value.trim(),
        sizes: fieldSizes.value.split(',').map((s) => s.trim()).filter(Boolean),
        images,
        in_stock: fieldInStock.checked,
      };

      if (!payload.name || !payload.category) {
        formMessage.textContent = 'Name and category are required.';
        saveButton.disabled = false;
        return;
      }

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
      loginMessage.textContent = 'Supabase is not configured. Add your project URL and anon key in supabase-config.js.';
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

  checkAccess();
});
