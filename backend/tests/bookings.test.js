"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
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
  const server = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", "backend/public", "backend/public/router.php"], {
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
    for (const file of [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`]) {
      await fs.unlink(file).catch((error) => { if (error.code !== "ENOENT") throw error; });
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
    contact: "test@example.com", notes: "Test only", consent: "yes", website: "" };
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
});
