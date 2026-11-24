"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { randomBytes } = require("node:crypto");

test("PHP booking API", { timeout: 30000 }, async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "casa-php-test-"));
  const dbPath = path.join(temporary, "bookings.sqlite");
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const token = randomBytes(32).toString("hex");
  const password = randomBytes(24).toString("hex");
  const setup = spawnSync("php", ["backend/bin/create-admin.php"], {
    cwd: path.resolve(__dirname, "../.."), env: { ...process.env, CASA_DB_PATH: dbPath },
    input: JSON.stringify({ username: "owner", password }), encoding: "utf8", windowsHide: true
  });
  assert.equal(setup.status, 0, setup.stderr);
  const server = spawn("php", ["-d", `session.save_path="${temporary.replace(/\\/g, '/')}"`, "-S", `127.0.0.1:${port}`, "-t", "backend/public", "backend/public/router.php"], {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, CASA_DB_PATH: dbPath, CASA_ADMIN_TOKEN: token },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  let spawnError;
  server.on("error", (error) => { spawnError = error; });
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (server.exitCode === null && !spawnError) {
      const closed = once(server, "close");
      server.kill();
      await closed;
    }
    for (const file of await fs.readdir(temporary)) {
      await fs.unlink(path.join(temporary, file));
    }
    await fs.rmdir(temporary);
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError) throw spawnError;
    try {
      if ((await fetch(base)).ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(ready, `PHP server did not start: ${output}`);
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 8);
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
  const valid = { bookingType: "Table reservation", date: date.toISOString().slice(0, 10),
    time: "12:00", guests: "1–2", occasion: "Birthday", name: "Test Customer",
    contact: "test@example.com", notes: '<script>alert("test")</script>', consent: "yes", website: "" };
  const admin = { Authorization: `Bearer ${token}` };
  const send = (body, extra = {}) => fetch(`${base}/api/bookings`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...extra
  });
  let id;

  await t.test("serves integrated frontend and blocks private files", async () => {
    assert.match(await (await fetch(base)).text(), /data-booking-endpoint="\/api\/bookings"/);
    assert.equal((await fetch(`${base}/script.js`)).status, 200);
    for (const url of ["/backend/storage/bookings.sqlite", "/storage/bookings.sqlite", "/src/bookings.php", "/.git/config", "/.env"]) {
      assert.equal((await fetch(base + url)).status, 404, url);
    }
  });
  await t.test("validates direct requests before writing", async () => {
    for (const change of [
      { time: "99:99", bookingType: "Private event or venue" }, { time: "12:99" },
      { date: "2030-02-30" }, { date: "2000-01-01" }, { time: "07:59" },
      { date: "2030-01-06" }, { consent: "no" }, { website: "spam" },
      { name: ["array"] }, { name: " " }, { contact: "abc1234567" },
      { bookingType: "unknown" }, { guests: "10000" }, { notes: "x".repeat(1501) }
    ]) {
      assert.equal((await send({ ...valid, ...change })).status, 422, JSON.stringify(change));
    }
    assert.equal((await send([], {})).status, 400);
    assert.equal((await send(valid, { body: "{" })).status, 400);
    assert.equal((await send(valid, { body: "x".repeat(8193) })).status, 413);
    assert.equal((await send(valid, { headers: { "Content-Type": "text/plain" } })).status, 415);
  });
  await t.test("creates persistent pending requests from URL-encoded forms", async () => {
    const response = await send(valid, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(valid) });
    assert.equal(response.status, 201);
    const result = await response.json();
    id = result.id;
    assert.match(id, /^[a-f0-9]{32}$/);
    assert.equal(result.status, "pending");
    assert.equal(result.duplicate, false);
    assert.ok((await fs.stat(dbPath)).size > 0);
  });
  await t.test("deduplicates simultaneous retries and limits changed requests", async () => {
    const retries = await Promise.all([send(valid), send(valid), send(valid)]);
    for (const response of retries) {
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.id, id);
      assert.equal(result.duplicate, true);
    }
    assert.equal((await send({ ...valid, notes: "Changed" })).status, 429);
  });
  await t.test("protects listing and status changes", async () => {
    assert.equal((await fetch(`${base}/api/bookings`)).status, 401);
    assert.equal((await fetch(`${base}/api/bookings`, { headers: { Authorization: "Bearer wrong" } })).status, 401);
    const update = (body, headers = admin, target = id) => fetch(`${base}/api/bookings/${target}`, {
      method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    assert.equal((await update({ status: "confirmed" }, {})).status, 401);
    assert.equal((await update({ status: "anything" })).status, 422);
    assert.equal((await update({ status: "confirmed" }, admin, "0".repeat(32))).status, 404);
    assert.equal((await update({ status: "confirmed" })).status, 200);
    const listed = await (await fetch(`${base}/api/bookings`, { headers: admin })).json();
    assert.equal(listed.bookings.length, 1);
    assert.equal(listed.bookings[0].status, "confirmed");
    assert.equal(listed.bookings[0].contact, valid.contact);
    assert.equal(listed.bookings[0].ip_hash, undefined);
    assert.equal((await fetch(`${base}/api/bookings?offset=-1`, { headers: admin })).status, 400);
    assert.equal((await fetch(`${base}/api/bookings`, { method: "DELETE", headers: admin })).status, 405);
  });
  await t.test("limits submissions across different contacts from one source", async () => {
    for (let count = 1; count < 10; count++) {
      assert.equal((await send({ ...valid, contact: `test${count}@example.com` })).status, 201);
    }
    const response = await send({ ...valid, contact: "blocked@example.com" });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "600");
  });

  await t.test("dashboard login, CSRF, search, updates, session rotation and logout", async () => {
    let cookie;
    let csrf;
    const request = async (url, body) => {
      const response = await fetch(base + url, {
        method: body ? "POST" : "GET", redirect: "manual",
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        body: body ? new URLSearchParams(body) : undefined
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const html = await response.text();
      csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)?.[1] || csrf;
      return { response, html, setCookie };
    };
    const initial = await request("/admin");
    assert.equal(initial.response.status, 200);
    assert.match(initial.html, /Sign in to review/);
    assert.doesNotMatch(initial.html, /test@example.com/);
    assert.match(initial.setCookie, /HttpOnly/i);
    assert.match(initial.setCookie, /SameSite=Strict/i);
    assert.match(initial.setCookie, /path=\/admin/i);
    assert.match(initial.response.headers.get("cache-control"), /no-store/);
    assert.match(csrf, /^[a-f0-9]{64}$/);
    const unauthorized = await request("/admin/status", { csrf, id, status: "cancelled" });
    assert.equal(unauthorized.response.status, 401, output);
    assert.equal((await request("/admin/login", { username: "owner", password })).response.status, 403);
    assert.equal((await request("/admin/login", { csrf, username: "owner", password: "incorrect-password" })).response.status, 401);
    const oldCookie = cookie;
    assert.equal((await request("/admin/login", { csrf, username: "owner", password })).response.status, 303);
    assert.notEqual(cookie, oldCookie);
    const dashboard = await request("/admin");
    assert.match(dashboard.html, /Welcome, owner/);
    assert.match(dashboard.html, /test@example.com/);
    assert.match(dashboard.html, /&lt;script&gt;/);
    assert.doesNotMatch(dashboard.html, /<script>/);
    assert.ok(!dashboard.html.includes(token));
    assert.ok(!dashboard.html.includes(password));
    assert.match((await request("/admin?q=nomatch")).html, /No requests found/);
    assert.match((await request("/admin?q=test%40example.com")).html, /Requests <span>\(1\)/);
    assert.equal((await request("/admin/status", { csrf: "wrong", id, status: "cancelled" })).response.status, 403);
    assert.equal((await request("/admin/status", { csrf, id, status: "invalid" })).response.status, 422);
    assert.equal((await request("/admin/status", { csrf, id, status: "cancelled" })).response.status, 303);
    assert.match((await request("/admin?status=cancelled")).html, /Booking status updated to cancelled/);
    const records = await (await fetch(`${base}/api/bookings`, { headers: admin })).json();
    assert.equal(records.bookings.find((row) => row.id === id).status, "cancelled");
    assert.equal((await fetch(`${base}/api/bookings`, { headers: { Cookie: cookie } })).status, 401);
    const signedInCookie = cookie;
    assert.equal((await request("/admin/logout", { csrf: "wrong" })).response.status, 403);
    assert.equal((await request("/admin/logout", { csrf })).response.status, 303);
    cookie = signedInCookie;
    assert.match((await request("/admin")).html, /Sign in to review/);
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await request("/admin/login", { csrf, username: "owner", password: "incorrect-password" })).response.status, 401);
    }
    const blocked = await request("/admin/login", { csrf, username: "owner", password });
    assert.equal(blocked.response.status, 429);
    assert.equal(blocked.response.headers.get("retry-after"), "900");
  });
});
