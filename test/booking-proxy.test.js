"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const handler = require("../api/bookings.js");

function createResponse() {
  return {
    headers: {},
    statusCode: 0,
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
    }
  };
}

test("rejects methods other than POST", async () => {
  const response = createResponse();

  await handler({ method: "GET", headers: {} }, response);

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, "POST");
});

test("returns a setup error when the Apps Script URL is missing", async () => {
  const previousUrl = process.env.APPS_SCRIPT_URL;
  delete process.env.APPS_SCRIPT_URL;
  const response = createResponse();

  try {
    await handler(
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: { name: "Test" }
      },
      response
    );
  } finally {
    if (previousUrl === undefined) {
      delete process.env.APPS_SCRIPT_URL;
    } else {
      process.env.APPS_SCRIPT_URL = previousUrl;
    }
  }

  assert.equal(response.statusCode, 503);
  assert.match(response.body, /Online booking is not available yet/);
});

test("forwards encoded form data and relays the Apps Script receipt", async () => {
  const previousUrl = process.env.APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  let forwarded;
  process.env.APPS_SCRIPT_URL = "https://script.google.com/macros/s/test-deployment/exec";
  global.fetch = async (url, options) => {
    forwarded = { url, options };
    return {
      ok: true,
      status: 200,
      headers: { get: () => "text/html; charset=utf-8" },
      text: async () => "<h1>Request received</h1>"
    };
  };
  const response = createResponse();

  try {
    await handler(
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: { bookingType: "Table reservation", name: "Ana Cruz" }
      },
      response
    );
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) {
      delete process.env.APPS_SCRIPT_URL;
    } else {
      process.env.APPS_SCRIPT_URL = previousUrl;
    }
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "<h1>Request received</h1>");
  assert.equal(forwarded.url, "https://script.google.com/macros/s/test-deployment/exec");
  assert.equal(forwarded.options.body, "bookingType=Table+reservation&name=Ana+Cruz");
});
