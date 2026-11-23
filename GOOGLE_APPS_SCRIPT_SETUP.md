# Booking form email and Google Sheet setup

The static website cannot write to Google Sheets or send email by itself. This Apps Script endpoint handles booking requests using the cafe's Google account.

## What it does

- Saves requests to a private Google Sheet created in the account that deploys the script.
- Emails new requests and the sheet link to `lordvillalon@gmail.com`.
- Sends an acknowledgement email when the customer provides an email address. Phone-only requests are saved and sent to the cafe without an SMS/WhatsApp auto-reply.
- Marks requests as pending; the cafe must still confirm availability and pricing.
- Keeps the current WhatsApp flow as a fallback until the endpoint is configured.

## Deploy the endpoint

1. Sign in to the Google account that should own the booking sheet, then open [Google Apps Script](https://script.google.com/).
2. Create a new project and replace the contents of `Code.gs` with [`google-apps-script/Code.gs`](./google-apps-script/Code.gs).
3. Save the project. Choose **Deploy → New deployment**, select **Web app**, and set **Execute as** to your account.
4. Set **Who has access** to **Anyone** so the website can submit requests. Deploy and approve the requested Sheets and email permissions.
5. Copy the Web app URL ending in `/exec`.

## Connect the website

Open `script.js` and set `BOOKING_ENDPOINT` to the Web app URL:

```js
const BOOKING_ENDPOINT = "https://script.google.com/macros/s/your-deployment-id/exec";
```

Save and redeploy the website. Once configured, booking submissions open a receipt page in a new tab; if the endpoint is blank, the form continues to use WhatsApp.

The Google Sheet is created automatically after the first valid request and remains private to the deploying Google account unless its owner shares it. The public endpoint includes a hidden spam field and short per-contact rate limiting; if it is abused, redeploy the web app to rotate its URL.
