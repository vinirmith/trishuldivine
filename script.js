document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const navList = document.querySelector('nav ul');

  if (toggle && navList) {
    toggle.addEventListener('click', () => {
      navList.classList.toggle('open');
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
});
