# Payments, orders & emails: go-live guide

Everything below is built and tested. What's left are the account steps only you can do
(Razorpay, Resend, Supabase, Cloudflare). **Do them in this order.** Use Razorpay *test mode*
first and only switch to live keys at step 7.

## How it works

1. Customer submits `checkout.html`. The browser sends **only product ids, sizes, quantities and the address** to `POST /payments/create-order`.
2. The Worker (`src/server/payments.js`) calls the database function `create_checkout_order`, which **prices the order from the `products` table** (the browser can never set a price), then creates the Razorpay order and returns it.
3. Razorpay Checkout opens. Card/UPI details never touch this site.
4. On success the browser calls `POST /payments/verify`. The Worker checks Razorpay's signature, confirms the payment with Razorpay (capturing it if needed), and marks the order paid.
5. **Razorpay's webhook** (`POST /payments/webhook`) is the safety net: it marks the order paid even if the customer closes the tab, records failures and refunds, and retries a failed confirmation email.
6. On the first successful payment the customer gets the confirmation email and the admin address(es) get a "new order" email. The order appears in **admin.html → Orders** (tab badge shows new orders; refreshes every 30 s).

Paid / emailed exactly once, however many times verify, the webhook or Razorpay retries fire.

## Tables (all created by `supabase/payments-setup.sql`)

| Table | Holds |
|---|---|
| `customers` (existing) | Contact details per buyer |
| `orders` (extended) | Order number (TD-1001…), status, payment status, totals, address snapshot, Razorpay order id, email status |
| `order_items` (extended) | Product, size, quantity, price **at time of purchase** |
| `payments` | Every payment attempt: Razorpay payment id, amount, method, status, failure reason, raw payload |
| `refunds` | Refunds reported by Razorpay |
| `webhook_events` | Every webhook received (de-duplication + audit log) |

The browser can no longer write any of these. Admins can read all of them; a signed-in customer can read only their own orders.

## Go-live steps

### 1. Database (Supabase → SQL Editor)
1. Make sure `schema.sql` and `admin-setup.sql` have been run (your admin emails must be in `admin_users`, otherwise the Orders tab shows a message instead of orders).
2. Paste and run **`supabase/payments-setup.sql`**. It is safe to run twice. At the end you should see the notice **"Self-test passed"** (it runs a fake order and rolls it back). If it shows an error instead, stop and send me the error.
3. Run it **before** deploying the new site. The old checkout wrote orders straight from the browser; that is now (deliberately) blocked.
4. Copy the **service_role** key (Project Settings → API). It is secret: never put it in a file in this folder.

### 2. Email (Resend)
1. Create an account at resend.com, **add the domain `trishuldivine.com`** and add the DNS records it shows (SPF + DKIM). Wait until it says *Verified*.
2. Create an API key (sending access).
3. The sender is `Trishul Divine <orders@trishuldivine.com>`. Change `EMAIL_FROM` in `wrangler.jsonc` if you want another address on the verified domain.
4. Put the address(es) that should be told about each new order in `ADMIN_NOTIFY_EMAIL` in `wrangler.jsonc` (comma-separated).

### 3. Razorpay (start in **Test Mode**)
1. Settings → API Keys → generate a test **Key Id** and **Key Secret**.
2. Settings → **Webhooks** → Add new webhook:
   - URL: `https://trishuldivine.com/payments/webhook`
   - Secret: any long random string (you'll reuse it in step 4)
   - Events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`
3. Settings → Payment Capture: **Automatic** (recommended; manual capture also works).

### 4. Cloudflare secrets
Run these in this folder (each asks you to paste the value):

```
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY
```

Note: `wrangler deploy` replaces plain variables with the ones in `wrangler.jsonc`, so keep `SITE_URL`, `EMAIL_FROM`, `SUPPORT_EMAIL` and `ADMIN_NOTIFY_EMAIL` there, not only in the dashboard. Secrets are kept.

### 5. Deploy
`npx wrangler deploy` (or push, if the site deploys from git).

### 6. Test with test keys
- Add a product to the cart, check out, and pay with Razorpay's test UPI (`success@razorpay`) or a test card from Razorpay's docs. Also try `failure@razorpay` once.
- You should see: the success screen with an order number, the confirmation email, the admin email, the order in **Admin → Orders**, a `payments` row, and `webhook_events` rows with status `processed` (Supabase → Table editor).
- Close the Razorpay window mid-payment and pay again: it reuses the same order.

### 7. Go live
1. Complete Razorpay's KYC / account activation. **Razorpay requires Terms & Conditions, Privacy Policy, Refund & Cancellation, Shipping/Delivery and Contact pages on the site** before approval. Those pages don't exist yet (only About and Contact do). This is the main thing still missing.
2. In Live Mode generate live keys and create the live webhook (same URL and events; it has its own secret).
3. Run `wrangler secret put` again for `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
4. Place one real small order, then refund it from the Razorpay dashboard and confirm the order flips to *Refunded* in the admin.
5. Recommended: add a Cloudflare rate-limiting rule for `POST /payments/create-order` (for example 10 requests/minute per IP) so bots can't flood your orders table.

## Day-to-day
- **Order paid but email shows "Failed"** in admin: open the order and press **Resend confirmation email** (the last error is shown there, usually an unverified Resend domain).
- **Refunds** are done in the Razorpay dashboard; the webhook updates the order automatically.
- **Out of stock** is the `in_stock` switch per product (there are no stock counts yet). Out-of-stock items are rejected at checkout and removed from carts.
- **Troubleshooting:** Cloudflare dashboard → Workers → trishuldivine → Logs (observability is on). Failed webhooks are listed in `webhook_events` with the error.

## Shipping (Shiprocket)

How it works:
1. **Checkout fee.** When the customer types a 6-digit pincode, `/payments/shipping-quote` asks Shiprocket for courier rates from `SHIPROCKET_PICKUP_PINCODE` to that pincode (100 g per item, box 10x10x5 cm, prepaid) and charges the **cheapest** courier, rounded up to the rupee. `create-order` works the fee out again on the server, so the browser can never change it. Unserviceable pincodes are refused with a message. **Until the Shiprocket secrets are set, shipping is free** and checkout works as before.
2. **After payment.** The paid order is created in Shiprocket automatically (`order_id` = our order number, e.g. `TD-1042`). If that fails, the order shows "Not in Shiprocket" in Admin → Orders with the error and a **Retry sending to Shiprocket** button.
3. **You ship from the Shiprocket panel:** pick the courier, generate the label, schedule the pickup.
4. **Tracking.** Shiprocket's webhook (`/shipping/webhook`) updates the order: courier, AWB, status. The first time the parcel is picked up / in transit the order becomes **shipped** and the customer gets a "your order has shipped" email with a tracking link; on delivery it becomes **delivered**.

Setup:
1. Sign up at shiprocket.in, finish KYC, recharge the wallet.
2. Settings → **Pickup Addresses**: add your pickup address. Put its nickname in `SHIPROCKET_PICKUP_LOCATION` and its pincode in `SHIPROCKET_PICKUP_PINCODE` (`wrangler.jsonc`, currently `Primary` / `521185`).
3. Settings → **API** → Configure → **Create an API user** (a separate email from your login). Add these Cloudflare **Secrets**: `SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD` (the API user), and `SHIPROCKET_WEBHOOK_TOKEN` (any long random text).
4. Settings → **API** → **Webhooks**: URL `https://trishuldivine.com/shipping/webhook`, token = the same `SHIPROCKET_WEBHOOK_TOKEN`, enable it.
5. Run `supabase/shipping-setup.sql` in the Supabase SQL editor (after `payments-setup.sql`). It ends with a self-test.
6. Deploy, place a test order to a real pincode, and check it appears in Shiprocket → Orders.

Tracking events are logged in `webhook_events` with source `shiprocket`.

## Not included yet (next steps)
- GST invoice PDF, COD and delivery outside India (checkout is India-only).
- Free-shipping threshold (e.g. free above ₹999) — easy to add on top of the Shiprocket rate.
- Booking the courier / label / pickup from our admin (done in the Shiprocket panel for now).
