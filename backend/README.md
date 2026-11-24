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

## Configuration

Set real environment variables before starting PHP; `.env` files are **not** automatically loaded.

| Variable | Purpose |
| --- | --- |
| `CASA_DB_PATH` | Optional SQLite file path; defaults to `backend/storage/bookings.sqlite`. Use an absolute path outside the public directory on persistent disk. |
| `CASA_ADMIN_TOKEN` | Required for management endpoints; use a randomly generated secret of at least 32 characters. Public submissions work without it. |

Example in PowerShell (generate and retain the token privately):

```powershell
$env:CASA_ADMIN_TOKEN = php -r 'echo bin2hex(random_bytes(32));'
php -S 127.0.0.1:8000 -t backend/public backend/public/router.php
```

Never put the admin token in frontend JavaScript, Git, or URLs. Restart the server after changing its environment.

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

There is no public endpoint for reading customer records. The management API is intended for trusted operators; there is no admin dashboard yet.

## Deployment

Use a PHP-capable host with persistent disk. The current Vercel Node/static setup does not run this PHP application; `backend/` is excluded from that deployment.

- Set the web server's document root to **`backend/public`**, never the repository root or `backend/`.
- Apache: enable `mod_rewrite` and permit the supplied `.htaccess` rules (`AllowOverride All`). Preserve the `Authorization` header through any proxy/PHP-FPM configuration.
- Other servers: route requests to `backend/public/index.php`; do not expose repository files directly.
- Keep the repository's root HTML/CSS/JS/logo files available to PHP, which serves only that explicit public asset list.
- Give PHP write access to the private database directory. Configure HTTPS, `display_errors=Off`, and private server error logging.
- Put the database on persistent local storage, back it up, and set a retention policy for customer records. This SQLite setup is intended for one application host.
- Behind a reverse proxy, rate limiting uses `REMOTE_ADDR`. Configure the server to supply a trusted client address; the app deliberately does not trust arbitrary forwarding headers.

PHP's built-in server is for local development only.

## Tests and contribution points

From the repository root (Node.js 18+ and PHP on PATH):

```sh
node --test test/booking-proxy.test.js backend/tests/bookings.test.js
```

The PHP integration tests launch an isolated local server and temporary database. They exercise persistence, validation, access control, duplicate handling, rate limits, and private-path protection without sending email or contacting external services.

- `src/bookings.php`: validation, schema initialization, and transactional persistence.
- `public/index.php`: public assets, routing, JSON responses, and management authorization.
- `public/router.php`: local development routing.
- `tests/bookings.test.js`: HTTP integration tests.

Email, SMS, payments, automatic availability checks, and an admin dashboard are not implemented. Staff must review requests through the management API and contact customers separately. A saved request is not a reservation confirmation.
