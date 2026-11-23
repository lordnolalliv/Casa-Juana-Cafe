"use strict";

const MAX_BODY_BYTES = 8192;
const APPS_SCRIPT_PATH = /^\/macros\/s\/[^/]+\/exec$/;

function errorPage(message) {
  return [
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>Booking request unavailable | Casa Juana Cafe</title>",
    "<style>body{margin:0;padding:48px 20px;background:#f7f4ec;color:#263a31;font:16px Arial,sans-serif}",
    ".card{max-width:560px;margin:8vh auto;padding:36px;background:#fffdf8;border-top:5px solid #9b452d}",
    "p{line-height:1.7;color:#5f6b62}a{color:#304c3e;font-weight:bold}</style>",
    "<main class=\"card\"><h1>We couldn't submit your request</h1>",
    `<p>${message}</p>`,
    "<p><a href=\"tel:+639603850662\">Call +63 960 385 0662</a> or ",
    "<a href=\"https://www.facebook.com/casajuanacafe\">message the cafe on Facebook</a>.</p>",
    "</main></html>"
  ].join("");
}

function sendHtml(response, statusCode, html) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(html);
}

function getAppsScriptUrl(value) {
  if (!value) {
    return null;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "script.google.com" ||
    !APPS_SCRIPT_PATH.test(url.pathname)
  ) {
    return null;
  }

  return url.toString();
}

function encodeFormBody(body) {
  if (Buffer.isBuffer(body)) {
    body = body.toString("utf8");
  }
  if (typeof body === "string") {
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      return null;
    }
    return body;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      form.append(key, value);
    } else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      for (const item of value) {
        form.append(key, item);
      }
    } else {
      return null;
    }
  }

  const encoded = form.toString();
  return Buffer.byteLength(encoded, "utf8") <= MAX_BODY_BYTES ? encoded : null;
}

async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendHtml(response, 405, errorPage("Please submit the booking form to send a request."));
  }

  const contentType = String(request.headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    return sendHtml(response, 415, errorPage("The booking form sent an unsupported request."));
  }

  const appsScriptUrl = getAppsScriptUrl(process.env.APPS_SCRIPT_URL);
  if (!appsScriptUrl) {
    console.error("Booking backend is not configured with a valid Apps Script URL.");
    return sendHtml(
      response,
      503,
      errorPage("Online booking is not available yet. Please call or message the cafe.")
    );
  }

  const body = encodeFormBody(request.body);
  if (body === null) {
    return sendHtml(response, 400, errorPage("The booking form data was invalid or too large."));
  }

  try {
    const upstream = await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html"
      },
      body,
      redirect: "follow"
    });
    const html = await upstream.text();
    const upstreamType = upstream.headers.get("content-type") || "";

    if (!upstream.ok || !upstreamType.toLowerCase().includes("text/html")) {
      console.error("Apps Script booking endpoint returned an unexpected response:", upstream.status);
      return sendHtml(
        response,
        502,
        errorPage("Online booking is temporarily unavailable. Please contact the cafe directly.")
      );
    }

    return sendHtml(response, 200, html);
  } catch (error) {
    console.error("Could not reach the Apps Script booking endpoint:", error.message);
    return sendHtml(
      response,
      502,
      errorPage("Online booking is temporarily unavailable. Please contact the cafe directly.")
    );
  }
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "8kb"
    }
  }
};
