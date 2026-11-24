# Casa Juana PHP backend

A PHP booking API with SQLite persistence. PHP serves the existing website and connects its form to the API. Requests start as `pending`; an authorized operator can list requests and mark them `confirmed` or `cancelled`.

## Run locally

Requirements: PHP 8.2+ with `pdo_sqlite` (check `php -m`). No Composer packages or separate database server are needed.

From the repository root:

```sh
php -S 127.0.0.1:8000 -t backend/public backend/public/router.php
```

Open **http://127.0.0.1:8000** and submit the booking form. The first valid request creates `backend/storage/bookings.sqlite`. Keep this database private and back it up; it contains customer information.

The PHP entry point injects the API endpoint into the form. Opening `index.html` directly or using the existing static deployment still uses WhatsApp. The existing Node/Google Apps Script integration is retained separately. Data is not synchronized between SQLite and Google Sheets.

## Staff dashboard

Create the owner account once, from the repository root in PowerShell:

```powershell
./backend/bin/setup-admin.ps1
```

The script prompts for a username and a hidden password (12–72 bytes). It stores only a password hash in the private SQLite database. No default credentials are shipped. If you set `CASA_DB_PATH`, use the same value for setup and the PHP server.

Start the PHP server with the command above, then open **http://127.0.0.1:8000/admin**. Sign in to search requests by name, contact or reference; filter by status; read customer details; and save pending, confirmed or cancelled statuses. Results are paginated, 20 per page. When email is configured, status changes queue a customer notification. The dashboard shows the email mode and queue totals.

The dashboard uses a server-side session, CSRF tokens, HttpOnly/SameSite cookies, and a five-attempt login limit per IP per 15 minutes. Sessions expire after 30 minutes of inactivity or eight hours total. Use **Sign out** on shared computers. An API token is not required for the dashboard and is never sent to the browser.

To reset the password or replace the single owner account, run the setup script again. This invalidates existing dashboard sessions. For non-Windows setup, `php backend/bin/create-admin.php` accepts a JSON object containing `username` and `password` on standard input; supply it through a private prompt or secret manager, not command-line arguments or a committed file.

## Configuration

Set real environment variables before starting PHP; `.env` files are **not** automatically loaded.

| Variable | Purpose |
| --- | --- |
| `CASA_DB_PATH` | Optional SQLite file path; defaults to `backend/storage/bookings.sqlite`. Use an absolute path outside the public directory on persistent disk. |
| `CASA_ADMIN_TOKEN` | Required for management endpoints; use a randomly generated secret of at least 32 characters. Public submissions work without it. |
| `CASA_SECURE_COOKIES` | Set to `1` on production HTTPS hosting, especially behind TLS termination, so the dashboard cookie is only sent over HTTPS. Omit for local HTTP development. |
| `CASA_MAIL_MODE` | `off` (default), `preview` (database previews only), or `mail` (send through the host's PHP `mail()` transport). |
| `CASA_MAIL_FROM` | Valid sender email address authorized by your hosting/mail provider. Required in preview and mail modes. |
| `CASA_OWNER_EMAIL` | Cafe notification recipient and reply-to address. Required in preview and mail modes. |

Example in PowerShell (generate and retain the token privately):

```powershell
$env:CASA_ADMIN_TOKEN = php -r 'echo bin2hex(random_bytes(32));'
php -S 127.0.0.1:8000 -t backend/public backend/public/router.php
```

Never put the admin token in frontend JavaScript, Git, or URLs. Restart the server after changing its environment.

## Email notifications

When enabled, a new booking queues an owner alert and a customer acknowledgement if the customer supplied an email. Pending receipts explicitly say the booking is not confirmed. Status changes through either the dashboard or API queue customer updates for confirmed, cancelled, or pending status. Phone-only customers need a call/message; only the owner alert is queued for their new requests.

Repeated submissions and saving an unchanged status do not add duplicate emails. Booking changes and email records commit together. Configuration errors reject the operation without a partial save; delivery failures happen later in the worker and cannot undo a saved booking. `emails_queued` in create/update API responses means queued, not delivered. Email is off by default and enabling it does not backfill old bookings.

### Local preview without sending

In the terminal that starts the PHP server:

```powershell
$env:CASA_MAIL_MODE = 'preview'
$env:CASA_MAIL_FROM = 'bookings@example.com'
$env:CASA_OWNER_EMAIL = 'owner@example.com'
php -S 127.0.0.1:8000 -t backend/public backend/public/router.php
```

Submit a test booking or change its status. In another terminal with the same mail environment variables (and `CASA_DB_PATH` if customized), run:

```powershell
php backend/bin/preview-emails.php
php backend/bin/send-emails.php
```

The preview command displays the latest 20 preview messages from the private database. These contain customer details; do not paste real previews into public issues or logs. The worker marks preview records `previewed` without calling a mail transport. Preview records are permanently bound to preview mode and will never send when you enable live mail later.

### Live delivery

1. Configure your PHP host's mail transfer service so PHP `mail()` can send from your authorized sender address. This implementation uses the host's transport; it does not implement authenticated SMTP directly. A typical unconfigured local Windows PHP installation will not send email.
2. Set `CASA_MAIL_MODE=mail`, `CASA_MAIL_FROM`, and `CASA_OWNER_EMAIL` in both the web application and scheduled worker environments. Use your real sender and cafe inbox. Restart the web server after changing its environment.
3. Schedule `php /absolute/path/to/backend/bin/send-emails.php` every minute using your host's scheduler, cron, or Windows Task Scheduler. Use the same private database path and a service account with database access. The scheduler must receive the environment variables explicitly; it will not inherit variables from an unrelated terminal.
4. Submit an authorized test request and verify receipt in the cafe/customer inboxes. This repository's automated tests do not send live email.

Each worker run processes at most 20 messages. The dashboard reports `pending`, `processing`, `accepted`, `failed`, and `previewed` totals. `accepted` means the transport accepted a message; inbox delivery, spam filtering and bounces are not tracked. Phone-only customers still require manual follow-up.

Failed sends retry with a delay, up to five attempts. Messages for the same booking and recipient are processed in order. A worker claims a message for 15 minutes so another worker will not concurrently take it; abandoned claims are recoverable. A crash after transport acceptance but before recording it can cause a retry and duplicate delivery. After five attempts, messages remain `failed` for investigation/manual follow-up. Repair mail configuration and inspect the private `email_outbox` table when diagnosing failures; errors shown by the app do not contain provider credentials.

Queued records contain customer information and remain in SQLite alongside bookings. Include them in your backup and retention policy. No scheduler or live mail service is installed automatically.

## API

All API responses are JSON. Errors use `{ "error": "message" }` with an appropriate HTTP status. Request bodies are limited to 8 KB. POST accepts JSON or URL-encoded forms.

### Create a request

`POST /api/bookings` is public and uses the existing form fields:

```json
{
  "bookingType": "Table reservation",
  "date": "2030-01-07",
  "time": "12:00",
  "guests": "1–2",
  "name": "Example Customer",
  "contact": "customer@example.com",
  "occasion": "Casual meal",
  "notes": "Window table if available",
  "website": "",
  "consent": "yes"
}
```

Use a future date. Dates follow Asia/Manila. Table requests must be Monday–Saturday, 08:00–17:00. Other booking types accept any valid time. Fields have byte-length limits; oversized fields are rejected rather than truncated.

A successful creation returns HTTP 201 with `id`, `status`, `duplicate`, and `message`. Retrying identical details within 10 minutes returns the existing reference with HTTP 200, without adding another row. Other requests using the same normalized contact must wait 30 seconds. Each source IP can create at most 10 requests per 10 minutes. Limits and duplicate checks run inside the database write transaction.

### List requests

`GET /api/bookings?offset=0` requires `Authorization: Bearer <token>`. Returns up to 50 records, newest first. Increase `offset` by 50 to fetch the next page. `created_at` is a Unix timestamp.

With the server running, use another PowerShell session with the same token set:

```powershell
$headers = @{ Authorization = "Bearer $env:CASA_ADMIN_TOKEN" }
Invoke-RestMethod http://127.0.0.1:8000/api/bookings -Headers $headers
```

### Update status

`PATCH /api/bookings/<id>` requires the same authorization header and accepts `pending`, `confirmed`, or `cancelled`:

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/bookings/<id>" -Method Patch -Headers $headers -ContentType 'application/json' -Body '{"status":"confirmed"}'
```

There is no public endpoint for reading customer records. The management API is intended for trusted integrations. Staff can use the session-authenticated `/admin` dashboard instead.

## Deployment

Use a PHP-capable host with persistent disk. The current Vercel Node/static setup does not run this PHP application; `backend/` is excluded from that deployment.

- Set the web server's document root to **`backend/public`**, never the repository root or `backend/`.
- Apache: enable `mod_rewrite` and permit the supplied `.htaccess` rules (`AllowOverride All`). Preserve the `Authorization` header through any proxy/PHP-FPM configuration.
- Other servers: route requests to `backend/public/index.php`; do not expose repository files directly.
- Keep the repository's root HTML/CSS/JS/logo files available to PHP, which serves only that explicit public asset list.
- Give PHP write access to the private database directory. Configure HTTPS, `display_errors=Off`, and private server error logging.
- Configure a private, writable PHP session directory and `CASA_SECURE_COOKIES=1` in production. Run owner setup on the production database. Do not share passwords or session files.
- Put the database on persistent local storage, back it up, and set a retention policy for customer records. This SQLite setup is intended for one application host.
- Behind a reverse proxy, rate limiting uses `REMOTE_ADDR`. Configure the server to supply a trusted client address; the app deliberately does not trust arbitrary forwarding headers.

PHP's built-in server is for local development only.

## Tests and contribution points

From the repository root (Node.js 18+ and PHP on PATH):

```sh
node --test test/booking-proxy.test.js backend/tests/bookings.test.js
php backend/tests/email.test.php
```

The PHP integration tests launch an isolated local server, temporary database and session directory. They exercise persistence, validation, access control, duplicate handling, rate limits, private-path protection, dashboard login/logout, session rotation, CSRF checks, search, status changes and HTML escaping without sending email or contacting external services.

- `src/bookings.php`: validation, schema initialization, and transactional persistence.
- `public/index.php`: public assets, routing, JSON responses, and management authorization.
- `public/router.php`: local development routing.
- `src/admin.php`: session authentication, login throttling and dashboard actions.
- `templates/admin.php` and `public/admin.css`: responsive staff interface.
- `bin/setup-admin.ps1` and `bin/create-admin.php`: private owner account setup/reset.
- `src/email.php`: transactional email queue, message templates, shared status updates and worker delivery.
- `bin/send-emails.php` and `bin/preview-emails.php`: queue worker and private preview inspection.
- `tests/email.test.php`: isolated in-memory tests of queueing, retries, ordering and delivery failures using fake transports; no real emails are sent.
- `tests/bookings.test.js`: HTTP integration tests.

SMS, payments and automatic availability checks are not implemented. Staff can review requests through the dashboard or management API. Customers need manual follow-up when email is disabled, fails, or only a phone number is supplied. A saved request is not a reservation confirmation.
