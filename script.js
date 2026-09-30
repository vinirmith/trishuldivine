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
      return Array.isArray(saved) ? saved : [];
    } catch (error) {
      return [];
    }
  };

  const saveCart = (items) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  };

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

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  const goToCheckout = async () => {
    window.location.href = 'checkout.html';
  };

  const renderAuthButton = async () => {
    const header = document.querySelector('header');
    if (!header || isAuthPage) return;

    if (!isStorePage) return;

    let actionGroup = header.querySelector('.header-actions');
    if (!actionGroup) {
      actionGroup = document.createElement('div');
      actionGroup.className = 'header-actions';
      const whatsapp = header.querySelector('.header-whatsapp');
      if (whatsapp) {
        header.insertBefore(actionGroup, whatsapp);
      } else {
        header.appendChild(actionGroup);
      }
    }

    let authButton = header.querySelector('.auth-button');
    if (!authButton) {
      authButton = document.createElement('button');
      authButton.type = 'button';
      authButton.className = 'auth-button';
      authButton.innerHTML = '<span>Checkout</span>';
      authButton.setAttribute('aria-label', 'Checkout');
      actionGroup.appendChild(authButton);
    }

    authButton.innerHTML = '<span>Checkout</span>';
    authButton.classList.remove('is-logged-in');
    authButton.onclick = () => window.location.href = 'checkout.html';
  };

  const createCartButton = () => {
    if (!isStorePage) return;

    const header = document.querySelector('header');
    if (!header || header.querySelector('.cart-button')) return;

    const cartButton = document.createElement('button');
    cartButton.type = 'button';
    cartButton.className = 'cart-button';
    cartButton.setAttribute('aria-label', 'View cart');
    cartButton.innerHTML = '<span>Cart</span><span class="cart-count">0</span>';

    let actionGroup = header.querySelector('.header-actions');
    const whatsapp = header.querySelector('.header-whatsapp');

    if (!actionGroup) {
      actionGroup = document.createElement('div');
      actionGroup.className = 'header-actions';

      if (whatsapp) {
        header.insertBefore(actionGroup, whatsapp);
      } else {
        header.appendChild(actionGroup);
      }
    }

    actionGroup.appendChild(cartButton);

    if (whatsapp && whatsapp.parentElement !== actionGroup) {
      actionGroup.appendChild(whatsapp);
    }
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

  const showCheckoutSuccess = () => {
    const panel = document.getElementById('cartPanel');
    if (!panel) return;

    const form = panel.querySelector('.checkout-form');
    const status = panel.querySelector('.cart-status');
    const checkoutButton = panel.querySelector('.cart-checkout');
    const summary = panel.querySelector('.cart-summary');

    if (form) form.hidden = true;
    if (status) {
      status.hidden = false;
      status.classList.add('is-success');
      status.textContent = 'Order placed successfully. We will contact you soon.';
    }
    if (checkoutButton) checkoutButton.hidden = true;
    if (summary) summary.textContent = 'Order placed';
  };

  const renderCart = () => {
    const items = getCart();
    const itemCount = items.reduce((total, item) => total + (Number(item.quantity) || 1), 0);
    const cartCount = document.querySelector('.cart-count');
    if (cartCount) cartCount.textContent = String(itemCount);

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
      <div class="cart-item" data-name="${item.name}">
        <img src="${item.image || 'images/gemstone_beads.jpeg'}" alt="${item.name}">
        <div class="cart-item-copy">
          <div class="cart-item-top">
            <h4>${item.name}</h4>
            <button class="cart-remove-item" type="button" aria-label="Remove ${item.name}">×</button>
          </div>
          <div class="cart-item-actions">
            <div class="cart-qty-controls">
              <button class="cart-qty-button" data-action="decrease" data-name="${item.name}" type="button">−</button>
              <span>${item.quantity}</span>
              <button class="cart-qty-button" data-action="increase" data-name="${item.name}" type="button">+</button>
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
    const name = sanitizeName(product.name || 'Product');
    const image = product.image || 'images/gemstone_beads.jpeg';
    const nameKey = name.toLowerCase();
    const fallbackPrices = {
      'smoky quartz bracelet': 1450,
      'gemstone mala': 2200,
      'rudraksha pendant': 1800,
      'bracelet': 1600,
      'rudraksha': 2000,
      'chain': 1800,
      ' gemstone beads': 1200,
    };
    const unitPrice = Number(product.unitPrice || fallbackPrices[nameKey] || 0);
    const items = getCart();
    const matchedIndex = items.findIndex((item) => item.name === name);

    resetCheckoutState();

    if (matchedIndex >= 0) {
      items[matchedIndex].quantity += 1;
    } else {
      items.push({ name, image, quantity: 1, unit_price: unitPrice });
    }

    saveCart(items);
    renderCart();
    openCart();
  };

  const submitOrderToSupabase = async (customerData) => {
    const client = getSupabaseClient();
    if (!client) {
      alert('Supabase is not configured yet. Add your project URL and anon key in supabase-config.js before using checkout.');
      return;
    }

    const items = getCart();
    if (!items.length) return;

    try {
      const { data: { session } } = await client.auth.getSession();
      const user = session?.user || null;

      const customerInsert = {
        full_name: customerData.full_name,
        phone: customerData.phone || null,
        email: customerData.email || null,
        address: customerData.address || null,
        city: customerData.city || null,
        state: customerData.state || null,
        pincode: customerData.pincode || null,
        country: customerData.country || null,
        user_id: user?.id || null,
      };

      const { data: customer, error: customerError } = await client
        .from('customers')
        .insert([customerInsert])
        .select()
        .single();

      if (customerError) throw customerError;

      const totalAmount = items.reduce((sum, item) => {
        const unitPrice = Number(item.unit_price || 0);
        return sum + unitPrice * Number(item.quantity || 1);
      }, 0);

      const { data: order, error: orderError } = await client
        .from('orders')
        .insert([{
          customer_id: customer.id,
          user_id: user?.id || null,
          status: 'pending',
          total_amount: totalAmount,
          shipping_address: customerData.address || null,
          notes: customerData.notes || null,
        }])
        .select()
        .single();

      if (orderError) throw orderError;

      const orderItems = items.map((item) => ({
        order_id: order.id,
        product_name: item.name,
        product_image: item.image || null,
        quantity: Number(item.quantity || 1),
        unit_price: Number(item.unit_price || 0),
      }));

      const { error: orderItemsError } = await client
        .from('order_items')
        .insert(orderItems);

      if (orderItemsError) throw orderItemsError;

      localStorage.removeItem(STORAGE_KEY);
      if (window.location.pathname.endsWith('checkout.html')) {
        const statusBox = document.getElementById('checkoutSuccess');
        const form = document.getElementById('checkoutForm');
        if (statusBox) statusBox.hidden = false;
        if (form) form.hidden = true;
        const summary = document.querySelector('.checkout-summary');
        if (summary) summary.textContent = 'Payment started';
        const payButton = document.getElementById('payNowButton');
        if (payButton) payButton.hidden = true;
      } else {
        renderCart();
        showCheckoutSuccess();
      }
    } catch (error) {
      console.error('Supabase order submission failed:', error);
      alert('Could not save the order to Supabase. Check your database setup and project keys.');
    }
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
    const image = (product.images && product.images[0]) || 'images/gemstone_beads.jpeg';
    const inStock = product.in_stock !== false;
    const sizes = Array.isArray(product.sizes) && product.sizes.length ? product.sizes.join(' · ') : '';

    const name = sanitizeName(product.name || 'Product');
    const description = (product.description || '').trim();
    const card = document.createElement('article');
    card.className = 'shop-product-card' + (inStock ? '' : ' is-out-of-stock');
    card.innerHTML = `
      <img class="shop-product-image" src="${escapeHtml(image)}" alt="${escapeHtml(name)}">
      <div class="shop-product-meta">
        <h3>${escapeHtml(name)}</h3>
        ${description ? `<p class="shop-product-desc">${escapeHtml(description)}</p>` : ''}
        <div class="shop-product-price">₹${Number(product.price || 0).toLocaleString('en-IN')}</div>
        ${sizes ? `<div class="shop-product-sizes">${escapeHtml(sizes)}</div>` : ''}
        ${inStock
          ? `<button type="button" class="add-to-cart" data-name="${escapeHtml(name)}" data-image="${escapeHtml(image)}" data-price="${product.price || 0}">Add to cart</button>`
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

    const { data, error } = await withRetry(() => client
      .from('products')
      .select('*')
      .eq('in_stock', true)
      .order('created_at', { ascending: false })
      .limit(3));

    if (error) {
      console.error('Failed to load featured products:', error);
      grid.innerHTML = '<p class="featured-empty">Could not load products right now. Please refresh.</p>';
      return;
    }

    if (!data || !data.length) {
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
      addToCart({
        name: addButton.dataset.name || 'Product',
        image: addButton.dataset.image || 'images/gemstone_beads.jpeg',
        unitPrice: addButton.dataset.price,
      });
      return;
    }

    const removeButton = event.target.closest('.cart-remove-item');
    if (removeButton) {
      const itemName = removeButton.closest('.cart-item')?.dataset.name;
      if (!itemName) return;
      const items = getCart().filter((item) => item.name !== itemName);
      saveCart(items);
      renderCart();
      return;
    }

    const qtyButton = event.target.closest('.cart-qty-button');
    if (qtyButton) {
      const itemName = qtyButton.dataset.name;
      const action = qtyButton.dataset.action;
      const items = getCart();
      const current = items.find((item) => item.name === itemName);
      if (!current) return;

      if (action === 'increase') {
        current.quantity += 1;
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
    createCartButton();
    createCartPanel();
    injectAddToCartButtons();
    renderCart();
    loadShopProducts();
    loadFeaturedProducts();
  }
  renderAuthButton();

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

    const populateCheckoutState = async () => {
      const items = getCart();
      const cartList = document.getElementById('checkoutCartItems');
      const total = document.getElementById('checkoutTotal');
      const emptyState = document.getElementById('checkoutEmpty');

      if (!cartList || !total || !emptyState) return;

      if (!items.length) {
        emptyState.hidden = false;
        cartList.hidden = true;
        total.textContent = '₹0';
        return;
      }

      const subtotal = items.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 1)), 0);
      cartList.innerHTML = items.map((item) => `
        <div class="checkout-item">
          <span>${item.name} × ${item.quantity}</span>
          <strong>₹${(Number(item.unit_price || 0) * Number(item.quantity || 1)).toLocaleString('en-IN')}</strong>
        </div>
      `).join('');
      total.textContent = `₹${subtotal.toLocaleString('en-IN')}`;
      emptyState.hidden = true;
      cartList.hidden = false;
    };

    populateCheckoutState();

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
        }
      }).catch(() => {});
    }

    checkoutForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(checkoutForm);
      const customer = {
        full_name: (formData.get('full_name') || '').toString().trim(),
        phone: (formData.get('phone') || '').toString().trim(),
        email: (formData.get('email') || '').toString().trim(),
        address: (formData.get('address') || '').toString().trim(),
        city: (formData.get('city') || '').toString().trim(),
        state: (formData.get('state') || '').toString().trim(),
        pincode: (formData.get('pincode') || '').toString().trim(),
        country: (formData.get('country') || '').toString().trim(),
        notes: (formData.get('notes') || '').toString().trim(),
      };

      if (!customer.full_name || !customer.phone || !customer.email || !customer.address || !customer.city || !customer.state || !customer.pincode) {
        alert('Please fill in your contact details and delivery address before continuing.');
        return;
      }

      await submitOrderToSupabase(customer);
    });
  }
});
