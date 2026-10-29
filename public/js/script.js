document.addEventListener('DOMContentLoaded', () => {
  const STORAGE_KEY = 'trishuldivine-cart';
  const CHECKOUT_REDIRECT_KEY = 'trishul_checkout_redirect';
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const isAuthPage = currentPath === 'auth.html';
  const isCheckoutPage = currentPath === 'checkout.html';
  const isStorePage = !isAuthPage && !isCheckoutPage;

  const getCart = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      // Only lines that carry a product id can be priced by the server at checkout.
      return Array.isArray(saved) ? saved.filter((item) => item && item.product_id && Number(item.quantity) > 0) : [];
    } catch (error) {
      return [];
    }
  };

  const saveCart = (items) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  };

  const MAX_LINE_QUANTITY = 20;
  const lineKey = (item) => `${item.product_id}::${item.size || ''}`;

  let supabaseClient = null;
  const getSupabaseClient = () => {
    if (supabaseClient) return supabaseClient;
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;

    if (!url || !key || url.includes('YOUR_SUPABASE') || key.includes('YOUR_SUPABASE')) {
      return null;
    }

    supabaseClient = window.supabase ? window.supabase.createClient(url, key) : null;
    return supabaseClient;
  };

  const withRetry = async (run, attempts = 3) => {
    let result;
    for (let i = 0; i < attempts; i += 1) {
      try {
        result = await run();
        if (!result.error) return result;
      } catch (err) {
        result = { data: null, error: err };
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * (i + 1)));
    }
    return result;
  };

  const sanitizeName = (value) => value.replace(/\s+/g, ' ').trim();

  // A size's own price from size_prices, or the product's base price when it has none.
  const sizePrice = (product, size) => {
    const own = Number(product.size_prices?.[size]);
    return own > 0 ? own : Number(product.price) || 0;
  };
  const cardPriceText = (product) => {
    const sizes = Array.isArray(product.sizes) ? product.sizes : [];
    const prices = sizes.length ? sizes.map((size) => sizePrice(product, size)) : [Number(product.price) || 0];
    const low = Math.min(...prices);
    return `${low < Math.max(...prices) ? 'From ' : ''}₹${low.toLocaleString('en-IN')}`;
  };
  window.trishulPricing = { sizePrice, cardPriceText };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  const goToCheckout = async () => {
    window.location.href = 'checkout.html';
  };

  const createCartBar = () => {
    if (!isStorePage || document.querySelector('.cart-bar')) return;

    const bar = document.createElement('div');
    bar.className = 'cart-bar';
    bar.hidden = true;
    bar.innerHTML = `
      <div class="cart-bar-info"><span class="cart-count">0</span><span class="cart-bar-text">items</span><strong class="cart-bar-total"></strong></div>
      <div class="cart-bar-actions">
        <button type="button" class="cart-button" aria-label="View cart">View cart</button>
        <a class="cart-bar-checkout" href="checkout.html">Checkout</a>
      </div>`;
    document.body.appendChild(bar);
  };

  const openCart = () => {
    const overlay = document.querySelector('.cart-overlay');
    const panel = document.getElementById('cartPanel');
    if (!overlay || !panel) return;
    overlay.classList.add('is-open');
    panel.classList.add('is-open');
    document.body.classList.add('cart-open');
  };

  const closeCart = () => {
    const overlay = document.querySelector('.cart-overlay');
    const panel = document.getElementById('cartPanel');
    if (!overlay || !panel) return;
    overlay.classList.remove('is-open');
    panel.classList.remove('is-open');
    document.body.classList.remove('cart-open');
    resetCheckoutState();
  };

  const resetCheckoutState = () => {
    const panel = document.getElementById('cartPanel');
    if (!panel) return;

    const form = panel.querySelector('.checkout-form');
    const status = panel.querySelector('.cart-status');
    const checkoutButton = panel.querySelector('.cart-checkout');

    if (form) form.hidden = false;
    if (status) {
      status.hidden = true;
      status.classList.remove('is-success');
      status.textContent = '';
    }
    if (checkoutButton) {
      checkoutButton.hidden = false;
      checkoutButton.disabled = false;
    }
  };

  const renderCart = () => {
    const items = getCart();
    const itemCount = items.reduce((total, item) => total + (Number(item.quantity) || 1), 0);
    const cartCount = document.querySelector('.cart-count');
    if (cartCount) cartCount.textContent = String(itemCount);
    const bar = document.querySelector('.cart-bar');
    if (bar) {
      const total = items.reduce((sum, item) => sum + (Number(item.unit_price) || 0) * (Number(item.quantity) || 1), 0);
      bar.hidden = itemCount === 0;
      document.body.classList.toggle('has-cart-bar', itemCount > 0);
      bar.querySelector('.cart-bar-text').textContent = itemCount === 1 ? 'item' : 'items';
      bar.querySelector('.cart-bar-total').textContent = total ? `₹${total.toLocaleString('en-IN')}` : '';
    }

    const panel = document.getElementById('cartPanel');
    if (!panel) return;

    const cartList = panel.querySelector('.cart-items');
    const cartSummary = panel.querySelector('.cart-summary');
    if (!cartList || !cartSummary) return;

    if (!items.length) {
      cartList.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
      cartSummary.textContent = '0 items';
      const checkout = panel.querySelector('.cart-checkout');
      if (checkout) checkout.disabled = true;
      return;
    }

    cartList.innerHTML = items.map((item) => `
      <div class="cart-item" data-key="${escapeHtml(lineKey(item))}">
        <img src="${escapeHtml(item.image || 'images/gemstone_beads.jpeg')}" alt="${escapeHtml(item.name)}">
        <div class="cart-item-copy">
          <div class="cart-item-top">
            <h4>${escapeHtml(item.name)}${item.size ? ` <span class="cart-item-size">(${escapeHtml(item.size)})</span>` : ''}</h4>
            <button class="cart-remove-item" type="button" aria-label="Remove ${escapeHtml(item.name)}">×</button>
          </div>
          <div class="cart-item-actions">
            <div class="cart-qty-controls">
              <button class="cart-qty-button" data-action="decrease" data-key="${escapeHtml(lineKey(item))}" type="button">−</button>
              <span>${item.quantity}</span>
              <button class="cart-qty-button" data-action="increase" data-key="${escapeHtml(lineKey(item))}" type="button">+</button>
            </div>
          </div>
        </div>
      </div>
    `).join('');

    const checkout = panel.querySelector('.cart-checkout');
    if (checkout) checkout.disabled = false;
    cartSummary.textContent = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
  };

  const addToCart = (product) => {
    const productId = String(product.id || '');
    if (!productId) return;
    const name = sanitizeName(product.name || 'Product');
    const size = sanitizeName(product.size || '');
    const image = product.image || 'images/gemstone_beads.jpeg';
    // Display price only: the server re-prices every order from the products table.
    const unitPrice = Number(product.unitPrice) || 0;
    const items = getCart();
    const key = lineKey({ product_id: productId, size });
    const existing = items.find((item) => lineKey(item) === key);

    resetCheckoutState();

    if (existing) {
      existing.quantity = Math.min(existing.quantity + 1, MAX_LINE_QUANTITY);
    } else {
      items.push({ product_id: productId, size, name, image, quantity: 1, unit_price: unitPrice });
    }

    saveCart(items);
    renderCart();
  };

  const createCartPanel = () => {
    if (!isStorePage || document.getElementById('cartPanel')) return;

    const overlay = document.createElement('div');
    overlay.className = 'cart-overlay';

    const panel = document.createElement('aside');
    panel.id = 'cartPanel';
    panel.className = 'cart-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = `
      <div class="cart-header">
        <h3>Your Cart</h3>
        <button class="cart-close" type="button" aria-label="Close cart">×</button>
      </div>
      <div class="cart-items"></div>
      <div class="checkout-form">
        <label>
          Full name
          <input type="text" name="full_name" placeholder="Your full name" />
        </label>
        <label>
          Phone
          <input type="tel" name="phone" placeholder="Phone number" />
        </label>
        <label>
          Email
          <input type="email" name="email" placeholder="Email address" />
        </label>
        <label>
          Address
          <textarea name="address" rows="3" placeholder="Shipping address"></textarea>
        </label>
      </div>
      <div class="cart-status" hidden></div>
      <div class="cart-footer">
        <div class="cart-summary">0 items</div>
        <button class="button button-gold cart-checkout" type="button">Continue Payment</button>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    panel.querySelector('.cart-close').addEventListener('click', closeCart);
    overlay.addEventListener('click', closeCart);

panel.querySelector('.cart-checkout').addEventListener('click', async () => {
      const items = getCart();
      if (!items.length) {
        closeCart();
        return;
      }

      await goToCheckout();
    });
  };

  const injectAddToCartButtons = () => {
    document.querySelectorAll('.shop-item').forEach((item) => {
      const img = item.querySelector('img');
      const productName = sanitizeName(img?.alt || item.getAttribute('data-name') || 'Product');
      const productImage = item.getAttribute('href') || img?.src || 'images/gemstone_beads.jpeg';

      if (!item.parentElement || item.parentElement.classList.contains('shop-item-wrap')) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'shop-item-wrap';
      item.parentNode.insertBefore(wrapper, item);
      wrapper.appendChild(item);

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'add-to-cart';
      addButton.dataset.name = productName;
      addButton.dataset.image = productImage;
      addButton.textContent = 'Add to cart';
      wrapper.appendChild(addButton);
    });

    document.querySelectorAll('.product-card').forEach((card) => {
      const title = card.querySelector('h3');
      const productName = sanitizeName(title?.textContent || card.getAttribute('data-name') || 'Product');
      const imageElement = card.querySelector('.product-image');
      const style = imageElement ? imageElement.getAttribute('style') || '' : '';
      const imageMatch = style.match(/url\(["']?([^"')]+)["']?\)/i);
      const productImage = imageMatch ? imageMatch[1] : 'images/gemstone_beads.jpeg';

      if (card.querySelector('.add-to-cart')) return;

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'add-to-cart';
      addButton.dataset.name = productName;
      addButton.dataset.image = productImage;
      addButton.textContent = 'Add to cart';
      card.appendChild(addButton);
    });
  };

  const renderShopProductCard = (product) => {
    const rawImage = (product.images && product.images[0]) || 'images/gemstone_beads.jpeg';
    const image = rawImage.replace(/^https:\/\/[a-z0-9]+\.supabase\.co/, window.SUPABASE_URL || '');
    const inStock = product.in_stock !== false;
    const sizeList = Array.isArray(product.sizes) ? product.sizes : [];
    const sizes = sizeList.length ? sizeList.join(' · ') : '';
    const productUrl = `product.html?id=${encodeURIComponent(product.id)}`;

    const name = sanitizeName(product.name || 'Product');
    const card = document.createElement('article');
    card.className = 'shop-product-card' + (inStock ? '' : ' is-out-of-stock');
    card.innerHTML = `
      <a href="product.html?id=${encodeURIComponent(product.id)}" aria-label="View ${escapeHtml(name)}"><img class="shop-product-image" src="${escapeHtml(image)}" alt="${escapeHtml(name)}"></a>
      <div class="shop-product-meta">
        <h3><a href="product.html?id=${encodeURIComponent(product.id)}">${escapeHtml(name)}</a></h3>
        <div class="shop-product-price">${cardPriceText(product)}</div>
        ${sizes ? `<div class="shop-product-sizes">${escapeHtml(sizes)}</div>` : ''}
        ${inStock
          ? (sizeList.length > 1
            ? `<button type="button" class="add-to-cart" data-href="${escapeHtml(productUrl)}">Select size</button>`
            : `<button type="button" class="add-to-cart" data-product-id="${escapeHtml(product.id)}" data-size="${escapeHtml(sizeList[0] || '')}" data-name="${escapeHtml(name)}" data-image="${escapeHtml(image)}" data-price="${sizePrice(product, sizeList[0])}">Add to cart</button>`)
          : `<span class="out-of-stock-badge">Out of stock</span>`}
      </div>
    `;
    return card;
  };

  const loadShopProducts = async () => {
    const grid = document.querySelector('.shop-grid[data-shop-category]');
    if (!grid) return;

    const category = grid.getAttribute('data-shop-category');
    const client = getSupabaseClient();
    if (!client) {
      grid.innerHTML = '<p class="shop-empty">Supabase is not configured yet.</p>';
      return;
    }

    const { data, error } = await withRetry(() => client
      .from('products')
      .select('*')
      .eq('category', category)
      .order('created_at', { ascending: false }));

    if (error) {
      console.error('Failed to load products:', error);
      grid.innerHTML = '<p class="shop-empty">Could not load products right now.</p>';
      return;
    }

    if (!data || !data.length) {
      grid.innerHTML = '<p class="shop-empty">New arrivals coming soon.</p>';
      return;
    }

    grid.innerHTML = '';
    data.forEach((product) => grid.appendChild(renderShopProductCard(product)));
  };

  const loadFeaturedProducts = async () => {
    const grid = document.querySelector('.product-grid[data-featured]');
    if (!grid) return;

    const client = getSupabaseClient();
    if (!client) return;

    const categories = ['mala', 'bracelets', 'rudraksha'];
    const results = await Promise.all(categories.map((category) => withRetry(() => client
      .from('products')
      .select('*')
      .eq('in_stock', true)
      .eq('category', category)
      .order('created_at', { ascending: false })
      .limit(3))));

    if (results.every((r) => r.error)) {
      console.error('Failed to load featured products:', results[0].error);
      grid.innerHTML = '<p class="featured-empty">Could not load products right now. Please refresh.</p>';
      return;
    }

    const data = results.flatMap((r) => r.data || []);

    if (!data.length) {
      grid.innerHTML = '<p class="featured-empty">New arrivals coming soon.</p>';
      return;
    }

    grid.innerHTML = '';
    data.forEach((product) => grid.appendChild(renderShopProductCard(product)));
  };

  document.addEventListener('click', (event) => {
    const cartToggle = event.target.closest('.cart-button');
    if (cartToggle) {
      event.preventDefault();
      const panel = document.getElementById('cartPanel');
      if (panel && panel.classList.contains('is-open')) {
        closeCart();
      } else {
        openCart();
      }
      return;
    }

    const addButton = event.target.closest('.add-to-cart');
    if (addButton) {
      event.preventDefault();
      if (addButton.disabled) return;
      if (addButton.dataset.href) {
        window.location.href = addButton.dataset.href;
        return;
      }
      addToCart({
        id: addButton.dataset.productId,
        name: addButton.dataset.name || 'Product',
        size: addButton.dataset.size || '',
        image: addButton.dataset.image || 'images/gemstone_beads.jpeg',
        unitPrice: addButton.dataset.price,
      });
      return;
    }

    const removeButton = event.target.closest('.cart-remove-item');
    if (removeButton) {
      const itemKey = removeButton.closest('.cart-item')?.dataset.key;
      if (!itemKey) return;
      const items = getCart().filter((item) => lineKey(item) !== itemKey);
      saveCart(items);
      renderCart();
      return;
    }

    const qtyButton = event.target.closest('.cart-qty-button');
    if (qtyButton) {
      const itemKey = qtyButton.dataset.key;
      const action = qtyButton.dataset.action;
      const items = getCart();
      const current = items.find((item) => lineKey(item) === itemKey);
      if (!current) return;

      if (action === 'increase') {
        current.quantity = Math.min(current.quantity + 1, MAX_LINE_QUANTITY);
      }
      if (action === 'decrease') {
        current.quantity -= 1;
      }

      const refreshed = items.filter((item) => item.quantity > 0);
      saveCart(refreshed);
      renderCart();
      return;
    }
  });

  const setActiveNav = () => {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('nav a').forEach((link) => {
      if (link.getAttribute('href') === currentPage) {
        link.classList.add('active');
      }
    });
  };

  const toggle = document.querySelector('.nav-toggle');
  const navList = document.querySelector('nav ul');

  if (toggle && navList) {
    toggle.addEventListener('click', () => {
      const isOpen = navList.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    navList.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navList.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  setActiveNav();
  if (isStorePage) {
    createCartBar();
    createCartPanel();
    injectAddToCartButtons();
    renderCart();
    loadShopProducts();
    loadFeaturedProducts();
  }

  const heroVideo = document.getElementById('bgVideo');
  if (heroVideo) {
    heroVideo.muted = true;
    const tryPlay = () => { const p = heroVideo.play(); if (p && p.catch) p.catch(() => {}); };
    tryPlay();
    ['touchstart', 'click', 'scroll'].forEach((type) => document.addEventListener(type, () => { if (heroVideo.paused) tryPlay(); }, { once: true, passive: true }));
  }

  const video = document.getElementById('bgVideo');
  const overlay = document.getElementById('enterOverlay');
  const enterButton = document.getElementById('enterButton');

  if (video && overlay && enterButton) {
    enterButton.addEventListener('click', () => {
      video.muted = false;
      video.play().catch(() => {});
      overlay.classList.add('hidden');
      setTimeout(() => overlay.remove(), 800);
    });
  }

  const shopItems = document.querySelectorAll('.shop-item');
  if (shopItems.length) {
    const lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.innerHTML = '<button class="lightbox-close" aria-label="Close">&times;</button><img alt="">';
    document.body.appendChild(lightbox);
    const lightboxImg = lightbox.querySelector('img');
    const lightboxClose = lightbox.querySelector('.lightbox-close');

    const openLightbox = (src, alt) => {
      lightboxImg.src = src;
      lightboxImg.alt = alt;
      lightbox.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    };
    const closeLightbox = () => {
      lightbox.classList.remove('is-open');
      document.body.style.overflow = '';
    };

    shopItems.forEach((item) => {
      item.addEventListener('click', (event) => {
        event.preventDefault();
        const img = item.querySelector('img');
        openLightbox(item.getAttribute('href') || img.src, img.alt);
      });
    });

    lightbox.addEventListener('click', (event) => {
      if (event.target === lightbox || event.target === lightboxClose) closeLightbox();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeLightbox();
    });
  }

  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(contactForm);
      const lines = [
        `Name: ${data.get('name')}`,
        data.get('phone') ? `Phone: ${data.get('phone')}` : null,
        `Email: ${data.get('email')}`,
        `Message: ${data.get('message')}`,
      ].filter(Boolean);
      const text = encodeURIComponent(lines.join('\n'));
      window.open(`https://wa.me/919398461678?text=${text}`, '_blank');
    });
  }

  const authForm = document.getElementById('authForm');
  if (authForm) {
    const modeToggle = document.querySelector('[data-auth-mode]');
    const modeField = document.getElementById('authMode');
    const submitButton = authForm.querySelector('button[type="submit"]');
    const googleButton = document.getElementById('googleLoginButton');

    const setAuthMessage = (message) => {
      const authMessage = document.getElementById('authMessage');
      if (authMessage) authMessage.textContent = message;
    };

    const updateMode = (mode) => {
      const showName = mode === 'signup';
      const nameField = document.getElementById('fullNameField');
      const nameInput = nameField ? nameField.querySelector('input') : null;

      if (nameField) {
        nameField.hidden = !showName;
        nameField.style.display = showName ? 'grid' : 'none';
      }
      if (nameInput) {
        nameInput.required = showName;
        nameInput.disabled = !showName;
      }
      if (modeField) modeField.value = mode;
      if (submitButton) {
        submitButton.textContent = mode === 'signup' ? 'Create account' : 'Log in';
      }
      if (modeToggle) {
        modeToggle.textContent = mode === 'signup' ? 'Already have an account? Log in' : 'Need an account? Sign up';
      }
    };

    if (googleButton) {
      googleButton.addEventListener('click', async () => {
        const client = getSupabaseClient();
        if (!client) {
          setAuthMessage('Supabase is missing. Add your project URL and anon key.');
          return;
        }

        const redirectTo = `${window.location.origin}/auth.html`;
        try {
          const { error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo,
              queryParams: {
                access_type: 'offline',
                prompt: 'select_account'
              }
            }
          });

          if (error) throw error;
        } catch (error) {
          console.error('Google auth error:', error);
          setAuthMessage(error.message || 'Google sign-in failed.');
        }
      });
    }

    if (modeToggle) {
      modeToggle.addEventListener('click', () => {
        const currentMode = modeField ? modeField.value : 'login';
        updateMode(currentMode === 'login' ? 'signup' : 'login');
      });
    }

    updateMode(modeField ? modeField.value : 'login');

    authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = authForm.querySelector('[name="email"]').value.trim();
      const password = authForm.querySelector('[name="password"]').value;
      const fullName = authForm.querySelector('[name="full_name"]').value.trim();
      const mode = modeField ? modeField.value : 'login';
      const client = getSupabaseClient();

      if (!client) {
        alert('Supabase is missing. Add your project URL and anon key.');
        return;
      }

      try {
        if (mode === 'signup') {
          const { data, error } = await client.auth.signUp({
            email,
            password,
            options: {
              data: {
                full_name: fullName,
              },
            },
          });

          if (error) throw error;

          const successMessage = document.getElementById('authMessage');
          if (successMessage) {
            successMessage.textContent = data.session
              ? 'Account created successfully. Redirecting...'
              : 'Account created. Check your email to confirm your address before logging in.';
          }

          if (data.session) {
            setTimeout(() => {
              const redirect = localStorage.getItem(CHECKOUT_REDIRECT_KEY) || 'index.html';
              window.location.href = redirect;
            }, 1200);
          }
        } else {
          const { data, error } = await client.auth.signInWithPassword({ email, password });
          if (error) throw error;

          const redirect = localStorage.getItem(CHECKOUT_REDIRECT_KEY) || 'index.html';
          window.location.href = redirect;
        }
      } catch (error) {
        console.error('Auth error:', error);
        const authMessage = document.getElementById('authMessage');
        if (authMessage) {
          authMessage.textContent = error.message || 'Authentication failed.';
        }
      }
    });
  }

  if (isAuthPage) {
    return;
  }

  const checkoutForm = document.getElementById('checkoutForm');
  if (checkoutForm) {
    const client = getSupabaseClient();
    const userSummary = document.getElementById('checkoutUserSummary');
    const payButton = document.getElementById('payNowButton');
    const errorBox = document.getElementById('checkoutError');
    const noticeBox = document.getElementById('checkoutNotice');
    const successBox = document.getElementById('checkoutSuccess');
    const inr = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const showError = (message) => {
      if (!errorBox) return;
      errorBox.textContent = message || '';
      errorBox.hidden = !message;
      if (message) errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    const setBusy = (busy, label) => {
      payButton.disabled = busy;
      payButton.textContent = busy ? label : 'Pay now';
    };

    // Re-reads name, price and availability from the catalogue so the summary
    // matches what the server will charge. Lines that can no longer be bought are dropped.
    const syncCartWithCatalog = async () => {
      const items = getCart();
      if (!client || !items.length) return { items, problems: [] };
      const ids = [...new Set(items.map((item) => item.product_id))];
      const { data, error } = await withRetry(() => client.from('products').select('id,name,price,sizes,size_prices,in_stock').in('id', ids));
      if (error || !data) return { items, problems: [] };

      const byId = new Map(data.map((product) => [product.id, product]));
      const problems = [];
      const synced = [];
      items.forEach((item) => {
        const product = byId.get(item.product_id);
        if (!product) {
          problems.push(`${item.name} is no longer available and was removed from your cart.`);
        } else if (product.in_stock === false) {
          problems.push(`${product.name} is out of stock and was removed from your cart.`);
        } else if ((product.sizes || []).length && !product.sizes.includes(item.size)) {
          problems.push(`${product.name} (${item.size || 'no size'}) is no longer available in that size and was removed from your cart.`);
        } else {
          synced.push({ ...item, name: sanitizeName(product.name), unit_price: sizePrice(product, item.size) });
        }
      });
      saveCart(synced);
      return { items: synced, problems };
    };

    // Promo code confirmed by the server for the current cart: { code, amount }.
    let appliedDiscount = null;
    // Shipping fee from the server for the current cart + pincode: { key, fee } (null = not known yet).
    let shippingQuote = null;

    const renderCheckoutSummary = (items) => {
      const cartList = document.getElementById('checkoutCartItems');
      const total = document.getElementById('checkoutTotal');
      const subtotalBox = document.getElementById('checkoutSubtotal');
      const discountRow = document.getElementById('checkoutDiscountRow');
      const shippingBox = document.getElementById('checkoutShipping');
      const emptyState = document.getElementById('checkoutEmpty');
      if (!cartList || !total || !emptyState) return;

      if (!items.length) {
        emptyState.hidden = false;
        cartList.hidden = true;
        total.textContent = '₹0';
        if (subtotalBox) subtotalBox.textContent = '₹0';
        if (discountRow) discountRow.hidden = true;
        if (shippingBox) shippingBox.textContent = '—';
        payButton.disabled = true;
        return;
      }

      const subtotal = items.reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 1), 0);
      cartList.innerHTML = items.map((item) => `
        <div class="checkout-item">
          <span>${escapeHtml(item.name)}${item.size ? ` (${escapeHtml(item.size)})` : ''} × ${item.quantity}</span>
          <strong>${inr(Number(item.unit_price || 0) * Number(item.quantity || 1))}</strong>
        </div>
      `).join('');
      const discount = appliedDiscount ? appliedDiscount.amount : 0;
      if (subtotalBox) subtotalBox.textContent = inr(subtotal);
      if (discountRow) {
        discountRow.hidden = !discount;
        document.getElementById('checkoutDiscountLabel').textContent = appliedDiscount ? `Discount (${appliedDiscount.code})` : 'Discount';
        document.getElementById('checkoutDiscount').textContent = `−${inr(discount)}`;
      }
      const shipping = shippingQuote ? shippingQuote.fee : 0;
      if (shippingBox) shippingBox.textContent = !shippingQuote ? 'Enter pincode' : (shipping ? inr(shipping) : 'Free');
      total.textContent = inr(subtotal - discount + shipping);
      emptyState.hidden = true;
      cartList.hidden = false;
      payButton.disabled = false;
    };

    const populateCheckoutState = async () => {
      renderCheckoutSummary(getCart());
      const { items, problems } = await syncCartWithCatalog();
      renderCheckoutSummary(items);
      if (noticeBox) {
        noticeBox.textContent = problems.join(' ');
        noticeBox.hidden = !problems.length;
      }
      // Prices may have changed, so ask the server again what the code is worth.
      if (appliedDiscount) applyPromo(appliedDiscount.code);
      refreshShipping();
    };

    if (client) {
      client.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          const emailInput = checkoutForm.querySelector('[name="email"]');
          const nameInput = checkoutForm.querySelector('[name="full_name"]');
          if (emailInput && !emailInput.value) emailInput.value = session.user.email || '';
          if (nameInput && !nameInput.value) nameInput.value = session.user.user_metadata?.full_name || '';
          if (userSummary) {
            userSummary.textContent = `Logged in as ${session.user.email}`;
          }
        } else if (userSummary) {
          userSummary.textContent = 'Checking out as a guest.';
        }
      }).catch(() => {});
    }

    const getAccessToken = async () => {
      if (!client) return null;
      try {
        const { data: { session } } = await client.auth.getSession();
        return session?.access_token || null;
      } catch (error) {
        return null;
      }
    };

    const requestJson = async (path, { method = 'GET', body } = {}) => {
      const token = await getAccessToken();
      const response = await fetch(path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      try { data = await response.json(); } catch (error) { /* non-JSON error page */ }
      return { ok: response.ok, status: response.status, data: data || {} };
    };

    const promoForm = document.getElementById('promoForm');
    const promoInput = document.getElementById('promoInput');
    const promoMessage = document.getElementById('promoMessage');

    const setPromoMessage = (text, ok) => {
      if (!promoMessage) return;
      promoMessage.textContent = text || '';
      promoMessage.classList.toggle('is-success', !!ok);
    };

    const cartLines = () => getCart().map((item) => ({ product_id: item.product_id, size: item.size || '', quantity: item.quantity }));

    // The server prices the cart and checks the code; the browser only displays the result.
    const applyPromo = async (rawCode) => {
      const code = String(rawCode || '').replace(/\s+/g, '').toUpperCase();
      if (!code) { setPromoMessage('Enter a promo code.'); return; }
      const items = cartLines();
      if (!items.length) { setPromoMessage('Your cart is empty.'); return; }
      setPromoMessage('Checking code…');
      try {
        const result = await requestJson('/payments/quote', { method: 'POST', body: { items, discount_code: code } });
        if (!result.ok) {
          appliedDiscount = null;
          setPromoMessage(result.data.message || 'This promo code could not be applied.');
        } else {
          appliedDiscount = { code: result.data.discount_code, amount: Number(result.data.discount_amount) || 0 };
          if (promoInput) promoInput.value = appliedDiscount.code;
          setPromoMessage(`${appliedDiscount.code} applied: you save ${inr(appliedDiscount.amount)}.`, true);
        }
      } catch (error) {
        setPromoMessage('Could not check the code. Please try again.');
      }
      renderCheckoutSummary(getCart());
    };

    // Shipping depends on the delivery pincode and the parcel weight (number of items).
    const shippingNote = document.getElementById('shippingNote');
    const pincodeInput = checkoutForm.querySelector('[name="pincode"]');
    let shippingRequest = 0;

    const setShippingNote = (text) => {
      if (!shippingNote) return;
      shippingNote.textContent = text || '';
      shippingNote.hidden = !text;
    };

    const refreshShipping = async () => {
      const pincode = (pincodeInput?.value || '').trim();
      const items = cartLines();
      const key = JSON.stringify({ pincode, items });
      if (shippingQuote && shippingQuote.key === key) return;
      shippingQuote = null;
      setShippingNote('');
      if (!/^[1-9]\d{5}$/.test(pincode) || !items.length) { renderCheckoutSummary(getCart()); return; }

      const requestId = ++shippingRequest;
      document.getElementById('checkoutShipping').textContent = 'Checking…';
      try {
        const result = await requestJson('/payments/shipping-quote', { method: 'POST', body: { items, pincode } });
        if (requestId !== shippingRequest) return; // a newer pincode was typed meanwhile
        if (result.ok) {
          shippingQuote = { key, fee: Number(result.data.shipping_fee) || 0 };
          if (result.data.estimated_days) setShippingNote(`Estimated delivery in ${result.data.estimated_days} days.`);
        } else {
          setShippingNote(result.data.message || 'We could not work out delivery charges for this pincode.');
        }
      } catch (error) {
        if (requestId === shippingRequest) setShippingNote('Could not check delivery charges. Please try again.');
      }
      renderCheckoutSummary(getCart());
    };

    if (pincodeInput) {
      pincodeInput.addEventListener('input', () => {
        pincodeInput.value = pincodeInput.value.replace(/\D/g, '').slice(0, 6);
        refreshShipping();
      });
    }

    if (promoForm) {
      promoForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (paymentOpen || finished) return;
        applyPromo(promoInput.value);
      });
      promoInput.addEventListener('input', () => {
        // Editing the code drops the applied one until it is applied again.
        if (appliedDiscount && promoInput.value.replace(/\s+/g, '').toUpperCase() !== appliedDiscount.code) {
          appliedDiscount = null;
          setPromoMessage('');
          renderCheckoutSummary(getCart());
        }
      });
    }

    const loadRazorpay = () => new Promise((resolve, reject) => {
      if (window.Razorpay) { resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load the payment window. Check your connection and try again.'));
      document.head.appendChild(script);
    });
    loadRazorpay().catch(() => {}); // warm up; the submit handler retries and reports errors

    let pending = null;        // the Razorpay order for the current cart + address, reused on retry
    let paymentOpen = false;
    let finished = false;

    populateCheckoutState();

    const showSuccess = (orderNumber, email) => {
      finished = true;
      saveCart([]);
      renderCheckoutSummary([]);
      showError('');
      if (noticeBox) noticeBox.hidden = true;
      checkoutForm.hidden = true;
      document.getElementById('checkoutOrderNumber').textContent = orderNumber || '';
      document.getElementById('checkoutOrderEmail').textContent = email || '';
      successBox.hidden = false;
      successBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const pollUntilPaid = async (checkout, attempts) => {
      for (let i = 0; i < attempts; i += 1) {
        try {
          const result = await requestJson(`/payments/status?token=${encodeURIComponent(checkout.public_token)}`);
          if (result.ok && result.data.payment_status === 'paid') return true;
        } catch (error) { /* keep polling */ }
        await sleep(2000);
      }
      return false;
    };

    const confirmPayment = async (checkout, response) => {
      setBusy(true, 'Confirming payment…');
      showError('');
      let confirmed = false;
      let rejected = false;
      try {
        const result = await requestJson('/payments/verify', { method: 'POST', body: {
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        } });
        confirmed = result.ok && result.data.status === 'paid';
        rejected = !result.ok && result.status >= 400 && result.status < 500 && result.status !== 429;
        if (rejected) showError(`${result.data.message || 'We could not confirm your payment.'} Your order number is ${checkout.order_number}. If money was deducted, please contact us with this number.`);
      } catch (error) { /* network problem: fall through to polling */ }

      // The server also learns about the payment from Razorpay directly, so give it a moment.
      if (!confirmed && !rejected) confirmed = await pollUntilPaid(checkout, 8);

      if (confirmed) {
        showSuccess(checkout.order_number, checkout.prefill?.email);
        return;
      }
      setBusy(false);
      paymentOpen = false;
      if (!rejected) {
        showError(`We received your payment details but are still confirming order ${checkout.order_number}. Please do not pay again. You will get an email shortly, or contact us with this order number.`);
      }
    };

    const openPayment = (checkout) => {
      const razorpay = new window.Razorpay({
        key: checkout.key_id,
        amount: checkout.amount,
        currency: checkout.currency,
        order_id: checkout.razorpay_order_id,
        name: 'Trishul Divine',
        description: checkout.description,
        prefill: checkout.prefill,
        notes: { order_number: checkout.order_number },
        theme: { color: '#3d4a39' },
        modal: {
          confirm_close: true,
          ondismiss: async () => {
            if (finished) return;
            setBusy(true, 'Checking payment…');
            // The customer may have paid and closed the window before the result came back.
            const paid = await pollUntilPaid(checkout, 2);
            if (paid) { showSuccess(checkout.order_number, checkout.prefill?.email); return; }
            paymentOpen = false;
            setBusy(false);
          },
        },
        handler: (response) => { confirmPayment(checkout, response); },
      });
      razorpay.on('payment.failed', (event) => {
        const reason = event?.error?.description;
        showError(`Payment failed${reason ? `: ${reason}` : ''}. You can try again.`);
      });
      razorpay.open();
    };

    checkoutForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (paymentOpen || finished) return;
      showError('');

      const formData = new FormData(checkoutForm);
      const field = (name) => (formData.get(name) || '').toString().trim();
      const customer = {
        full_name: field('full_name'),
        phone: field('phone'),
        email: field('email'),
        address: field('address'),
        city: field('city'),
        state: field('state'),
        pincode: field('pincode'),
        country: field('country'),
        notes: field('notes'),
      };

      if (!customer.full_name || !customer.phone || !customer.email || !customer.address || !customer.city || !customer.state || !customer.pincode) {
        showError('Please fill in your contact details and delivery address before continuing.');
        return;
      }
      if (!/^[6-9]\d{9}$/.test(customer.phone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''))) {
        showError('Please enter a valid 10-digit mobile number.');
        return;
      }
      if (!/^[1-9]\d{5}$/.test(customer.pincode)) {
        showError('Please enter a valid 6-digit pincode.');
        return;
      }

      const items = cartLines();
      const discountCode = appliedDiscount ? appliedDiscount.code : '';
      if (!items.length) {
        showError('Your cart is empty.');
        return;
      }

      paymentOpen = true;
      setBusy(true, 'Starting payment…');
      try {
        await loadRazorpay();
        const signature = JSON.stringify({ items, customer, discountCode });
        if (!pending || pending.signature !== signature) {
          const result = await requestJson('/payments/create-order', { method: 'POST', body: { items, customer, discount_code: discountCode } });
          if (!result.ok) {
            if (/discount/.test(result.data.error || '')) {
              appliedDiscount = null;
              setPromoMessage(result.data.message);
            }
            if (result.data.error === 'not_serviceable') setShippingNote(result.data.message);
            throw new Error(result.data.message || 'We could not start the payment. Please try again.');
          }
          pending = { signature, checkout: result.data };
          // Show exactly what the server will charge.
          const fee = Number(result.data.shipping_fee) || 0;
          document.getElementById('checkoutShipping').textContent = fee ? inr(fee) : 'Free';
          document.getElementById('checkoutTotal').textContent = inr(result.data.total_amount);
        }
        setBusy(true, 'Waiting for payment…');
        openPayment(pending.checkout);
      } catch (error) {
        console.error('Checkout failed:', error);
        showError(error.message || 'We could not start the payment. Please try again.');
        paymentOpen = false;
        setBusy(false);
        populateCheckoutState();
      }
    });
  }
});
