document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const navList = document.querySelector('nav ul');

  if (toggle && navList) {
    toggle.addEventListener('click', () => {
      const isOpen = navList.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    navList.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navList.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('nav a').forEach(link => {
    if (link.getAttribute('href') === currentPage) {
      link.classList.add('active');
    }
  });

  const video = document.getElementById('bgVideo');
  const overlay = document.getElementById('enterOverlay');
  const enterButton = document.getElementById('enterButton');

  if (video && overlay && enterButton) {
    // Browsers block audio until the user interacts with the page, so the
    // entrance click both reveals the site and starts sound in one gesture.
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

    shopItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const img = item.querySelector('img');
        openLightbox(item.getAttribute('href') || img.src, img.alt);
      });
    });

    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox || e.target === lightboxClose) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLightbox();
    });
  }

  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
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
});
