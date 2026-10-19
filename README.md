# Trishul Divine

Online store for natural gemstones, Rudraksha and spiritual jewellery.
Static site + Cloudflare Worker (payments, order emails, Supabase proxy) + Supabase (database, auth, storage).

## Structure

```
public/                  The website. Cloudflare serves exactly this folder (nothing else is published).
  *.html                 Pages: index, about, contact, bracelets, rudraksha, mala, product, checkout, auth, admin
  css/style.css          All styles
  js/                    script.js (shop, cart, checkout), product.js, admin.js,
                         supabase-config.js, admin-config.js (admin allow-list)
  images/                Product photos. Do not rename or move files inside: product image
                         paths such as images/Bracelet/azurite.jpg are stored in the database.
    brand/logo.png       Header logo
    pages/               Page banners (contact)
  media/                 Background video for the home page
src/
  worker.js              Worker entry: serves public/, routes /payments/*, proxies /api/* to Supabase
  server/                Payment code: payments.js (endpoints), razorpay.js, email.js, supabase.js
supabase/                SQL to run in the Supabase SQL editor (schema, admin setup, payments-setup)
docs/                    PAYMENTS_SETUP.md (go-live guide) and other documents
assets-source/           Originals not used by the site (not published)
wrangler.jsonc           Cloudflare config (entry: src/worker.js, assets: ./public)
CNAME                    Custom domain marker
```

## Common commands

```
npx wrangler dev          # run the site + Worker locally (secrets: copy values into a local .dev.vars file, never commit it)
npx wrangler deploy       # publish
npx wrangler secret put NAME
```

Setup for payments, orders and emails: see `docs/PAYMENTS_SETUP.md`.

## Rules of thumb
- Add new pages to `public/` and link CSS/JS as `css/style.css`, `js/...`.
- CSS refers to images as `../images/...` (relative to the CSS file).
- Never put secrets in `public/` or any committed file; use `wrangler secret put`.
