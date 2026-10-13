document.addEventListener('DOMContentLoaded', async () => {
  const page = document.getElementById('productPage');
  if (!page) return;

  const ZOOM = 2.5;
  const PANE_SCALE = 0.5; // zoom pane is this fraction of the image's width and height (0.5 = a quarter of the area)
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  // Description markup from the admin: blank line = paragraph, "- " lines = bullets, **text** = bold.
  const inline = (text) => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const formatDescription = (text) => {
    const html = [];
    let list = [];
    let para = [];
    const flushList = () => { if (list.length) html.push(`<ul>${list.join('')}</ul>`); list = []; };
    const flushPara = () => { if (para.length) html.push(`<p>${para.join('<br>')}</p>`); para = []; };
    String(text).replace(/\r/g, '').split('\n').forEach((raw) => {
      const line = raw.trim();
      const bullet = line.match(/^[-*\u2022]\s+(.*)$/);
      if (!line) { flushList(); flushPara(); }
      else if (bullet) { flushPara(); list.push(`<li>${inline(bullet[1])}</li>`); }
      else { flushList(); para.push(inline(line)); }
    });
    flushList(); flushPara();
    return html.join('');
  };
  const fixUrl = (url) => String(url).replace(/^https:\/\/[a-z0-9]+\.supabase\.co/, window.SUPABASE_URL || '');
  const message = (text) => { page.innerHTML = `<p class="shop-empty">${escapeHtml(text)}</p>`; };

  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) return message('Product not found.');

  const client = window.supabase && window.SUPABASE_URL
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;
  if (!client) return message('Could not load this product right now.');

  let result;
  for (let i = 0; i < 3; i += 1) {
    try {
      result = await client.from('products').select('*').eq('id', id).maybeSingle();
      if (!result.error) break;
    } catch (err) {
      result = { data: null, error: err };
    }
    await new Promise((resolve) => setTimeout(resolve, 600 * (i + 1)));
  }
  if (result.error) return message('Could not load this product right now.');
  const product = result.data;
  if (!product) return message('Product not found.');

  const name = String(product.name || 'Product').replace(/\s+/g, ' ').trim();
  const images = (product.images && product.images.length ? product.images : ['images/gemstone_beads.jpeg']).map(fixUrl);
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  const inStock = product.in_stock !== false;
  const price = Number(product.price || 0);
  let current = 0;
  let size = sizes[0] || '';

  document.title = `${name} - Trishuldivine`;

  page.innerHTML = `
    <div class="product-gallery">
      <div class="product-main">
        <img class="product-main-image" src="${escapeHtml(images[0])}" alt="${escapeHtml(name)}">
        <div class="zoom-lens" hidden></div>
        ${images.length > 1 ? `
          <button type="button" class="gallery-arrow gallery-prev" aria-label="Previous image">&#8249;</button>
          <button type="button" class="gallery-arrow gallery-next" aria-label="Next image">&#8250;</button>` : ''}
      </div>
      ${images.length > 1 ? `<div class="product-thumbs">${images.map((src, i) => `
        <button type="button" class="product-thumb${i === 0 ? ' active' : ''}" data-index="${i}" aria-label="Show image ${i + 1}"><img src="${escapeHtml(src)}" alt=""></button>`).join('')}</div>` : ''}
    </div>
    <div class="product-info">
      <div class="zoom-pane" hidden></div>
      <a class="product-back" href="${escapeHtml(product.category)}.html">&larr; ${escapeHtml(product.category)}</a>
      <h1>${escapeHtml(name)}</h1>
      <div class="product-price">&#8377;${price.toLocaleString('en-IN')}</div>
      <p class="product-tax">Prices are inclusive of all taxes</p>
      ${sizes.length ? `
        <h2 class="product-label">Select Size</h2>
        <div class="product-sizes">${sizes.map((s, i) => `
          <button type="button" class="size-option${i === 0 ? ' selected' : ''}" data-size="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>` : ''}
      ${inStock
        ? '<button type="button" class="add-to-cart product-add"></button>'
        : '<span class="out-of-stock-badge">Out of stock</span>'}
    </div>
    ${product.description ? `<section class="product-about"><h2 class="product-label">About this product</h2><div class="product-desc">${formatDescription(product.description)}</div></section>` : ''}`;

  // "You may also like": three other products, same category first.
  try {
    const { data: others } = await client.from('products').select('*').neq('id', id).limit(50);
    const pool = (others || []).filter((p) => p.in_stock !== false);
    const sameCategory = pool.filter((p) => p.category === product.category);
    const rest = pool.filter((p) => p.category !== product.category);
    const shuffle = (list) => list.map((p) => [Math.random(), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const picks = [...shuffle(sameCategory), ...shuffle(rest)].slice(0, 3);
    if (picks.length) {
      const section = document.createElement('section');
      section.className = 'product-related';
      section.innerHTML = `<h2 class="product-label">You may also like</h2><div class="related-grid">${picks.map((p) => {
        const img = fixUrl((p.images && p.images[0]) || 'images/gemstone_beads.jpeg');
        const pname = String(p.name || 'Product').replace(/\s+/g, ' ').trim();
        return `<article class="shop-product-card">
          <a href="product.html?id=${encodeURIComponent(p.id)}" aria-label="View ${escapeHtml(pname)}"><img class="shop-product-image" src="${escapeHtml(img)}" alt="${escapeHtml(pname)}"></a>
          <div class="shop-product-meta">
            <h3><a href="product.html?id=${encodeURIComponent(p.id)}">${escapeHtml(pname)}</a></h3>
            <div class="shop-product-price">&#8377;${Number(p.price || 0).toLocaleString('en-IN')}</div>
            <button type="button" class="add-to-cart" data-name="${escapeHtml(pname)}" data-image="${escapeHtml(img)}" data-price="${p.price || 0}">Add to cart</button>
          </div>
        </article>`;
      }).join('')}</div>`;
      page.appendChild(section);
    }
  } catch (err) { /* recommendations are optional */ }

  const mainBox = page.querySelector('.product-main');
  const mainImg = page.querySelector('.product-main-image');
  const lens = page.querySelector('.zoom-lens');
  const pane = page.querySelector('.zoom-pane');
  const addButton = page.querySelector('.product-add');

  const syncAddButton = () => {
    if (!addButton) return;
    addButton.textContent = 'Add to cart';
    // The cart is keyed by name, so each size becomes its own cart line.
    addButton.dataset.name = size ? `${name} (${size})` : name;
    addButton.dataset.image = images[0];
    addButton.dataset.price = String(price);
  };
  syncAddButton();

  const show = (index) => {
    current = (index + images.length) % images.length;
    mainImg.src = images[current];
    page.querySelectorAll('.product-thumb').forEach((thumb, i) => thumb.classList.toggle('active', i === current));
  };

  page.querySelector('.gallery-prev')?.addEventListener('click', () => show(current - 1));
  page.querySelector('.gallery-next')?.addEventListener('click', () => show(current + 1));
  page.querySelectorAll('.product-thumb').forEach((thumb) => {
    thumb.addEventListener('click', () => show(Number(thumb.dataset.index)));
  });
  page.querySelectorAll('.size-option').forEach((button) => {
    button.addEventListener('click', () => {
      size = button.dataset.size;
      page.querySelectorAll('.size-option').forEach((b) => b.classList.toggle('selected', b === button));
      syncAddButton();
    });
  });

  // Hover zoom: a lens over the image picks the region, the pane beside it shows it magnified.
  if (!window.matchMedia('(hover: hover) and (min-width: 901px)').matches) return;

  const hideZoom = () => { lens.hidden = true; pane.hidden = true; };
  const moveZoom = (event) => {
    const box = mainBox.getBoundingClientRect();
    const paneW = box.width * PANE_SCALE;
    const paneH = box.height * PANE_SCALE;
    const lensW = paneW / ZOOM;
    const lensH = paneH / ZOOM;
    const x = Math.min(Math.max(event.clientX - box.left - lensW / 2, 0), box.width - lensW);
    const y = Math.min(Math.max(event.clientY - box.top - lensH / 2, 0), box.height - lensH);

    lens.style.cssText = `width:${lensW}px;height:${lensH}px;left:${x}px;top:${y}px`;
    lens.hidden = false;

    const paneBox = page.querySelector('.product-info').getBoundingClientRect();
    pane.style.cssText = `width:${paneW}px;height:${paneH}px;left:0;top:${box.top - paneBox.top}px;`
      + `background-image:url("${images[current].replace(/"/g, '%22')}");`
      + `background-size:${box.width * ZOOM}px ${box.height * ZOOM}px;`
      + `background-position:${-x * ZOOM}px ${-y * ZOOM}px`;
    pane.hidden = false;
  };

  mainBox.addEventListener('mousemove', moveZoom);
  mainBox.addEventListener('mouseleave', hideZoom);
});
