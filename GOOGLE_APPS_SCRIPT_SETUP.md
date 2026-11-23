# Booking backend: email and Google Sheet setup

When enabled, the website submits bookings to the Vercel function in `api/bookings.js`. That backend securely forwards the form to Apps Script, which validates requests, writes to the private Google Sheet, and sends email using the cafe's Google account.

## What it does

- Saves requests to the configured private Google Sheet.
- Emails new requests and the sheet link to `lordvillalon@gmail.com`.
- Sends an acknowledgement email when the customer provides an email address. Phone-only requests are saved and sent to the cafe without an SMS/WhatsApp auto-reply.
- Marks requests as pending; the cafe must still confirm availability and pricing.
- Keeps the current WhatsApp flow as a fallback until the endpoint is configured.

## Deploy the Apps Script handler

1. Sign in to the Google account that should own the booking sheet, then open [Google Apps Script](https://script.google.com/).
2. Open the Apps Script project that should own the booking sheet and replace the contents of `Code.gs` with [`google-apps-script/Code.gs`](./google-apps-script/Code.gs).
3. Open **Project Settings → Script properties** and add `CASA_JUANA_BOOKINGS_SHEET_ID`. Set its value to the spreadsheet ID from the cafe's booking sheet URL (the text between `/d/` and `/edit`). If this property is omitted, the script creates a new private sheet on the first request.
4. Save the project. Choose **Deploy → New deployment**, select **Web app**, and set **Execute as** to your account.
5. Set **Who has access** to **Anyone** so the website can submit requests. Deploy and approve the requested Sheets and email permissions.

## Connect the Vercel website

In Vercel, open the project settings and add an environment variable:

- **Name:** `APPS_SCRIPT_URL`
- **Value:** the deployed Apps Script Web app URL ending in `/exec`
- **Environment:** Production (and Preview if you want to test preview deployments)

After the Apps Script deployment is live and `APPS_SCRIPT_URL` is set in Vercel, set `BOOKING_ENDPOINT` in `script.js` to `"/api/bookings"` and redeploy. The Apps Script URL stays on the server and is not included in the browser code. Until both steps are complete, leave `BOOKING_ENDPOINT` blank so the form continues to use WhatsApp.

The prepared booking sheet remains private to its Google account unless its owner shares it. The Apps Script handler includes a hidden spam field and short per-contact rate limiting; if the public endpoint is abused, redeploy the Apps Script Web app to rotate its URL.

Run the Vercel proxy tests locally with `node --test test\booking-proxy.test.js`.
