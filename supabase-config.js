// Production and local dev both go through the trishuldivine.com/api proxy (direct *.supabase.co is blocked on some networks).
window.SUPABASE_URL = /(^|\.)trishuldivine\.com$/.test(window.location.hostname) ? window.location.origin + '/api'
  : ['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'https://trishuldivine.com/api'
  : 'https://acnhzuiisexsiuondawt.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjbmh6dWlpc2V4c2l1b25kYXd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2ODc0NDEsImV4cCI6MjEwNjI2MzQ0MX0.gGTZ_yIRFmogjXOaxEXHDavFzm0PjAoa9kmxZV8o7O0';
