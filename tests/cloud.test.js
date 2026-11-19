const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../cloud.js');
const { handleSync } = require('../api/_core.js');
const { createFakeTurso } = require('./fake-turso.js');

const ENV = { TURSO_DATABASE_URL: 'libsql://x.turso.io', TURSO_AUTH_TOKEN: 't', SYNC_PASSWORD: 'pw' };
const mkData = (n) => ({ sellers: [], decks: [{ id: 'd1', name: 'x', items: [{ code: 'A', qty: n }], purchases: [] }], cards: {} });

// เซิร์ฟเวอร์จริง (api/_core.js) ต่อกับ Turso จำลอง เครื่องหลายเครื่องใช้ร่วมกันได้
function makeServer() {
  const fake = createFakeTurso();
  const server = {
    fake,
    down: false,
    status404: false,
    beforeReply: null,
    async fetch(_url, init) {
      if (server.down) throw new TypeError('network down');
      if (server.status404) return { status: 404, json: async () => ({}) };
      const out = await handleSync(
        { method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null },
        ENV, fake.fetchImpl,
      );
      if (server.beforeReply) server.beforeReply(init.method);
      return { status: out.status, json: async () => out.body };
    },
  };
  return server;
}

function makeDevice(server, { pristine = false, data = mkData(1), choice = null } = {}) {
  const store = new Map();
  const d = { data, statuses: [], timers: [], conflicts: [], choice };
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  d.store = store;
  d.cloud = create({
    getData: () => d.data,
    applyData: (x) => { d.data = x; },
    isPristine: () => pristine,
    onStatus: (s, det) => d.statuses.push(det ? `${s}:${det}` : s),
    resolveConflict: async (info) => { d.conflicts.push(info); return d.choice; },
    fetchImpl: (u, i) => server.fetch(u, i),
    storage,
    setTimer: (fn) => { d.timers.push(fn); return d.timers.length; },
    clearTimer: (id) => { if (id) d.timers[id - 1] = null; },
  });
  d.last = () => d.statuses[d.statuses.length - 1];
  return d;
}

const cloudData = (server) => JSON.parse(server.fake.db.row.data);

test('เปิดซิงก์ตอนคลาวด์ยังว่าง → ส่งข้อมูลเครื่องนี้ขึ้นไป', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(4) });
  await a.cloud.enable('pw');
  assert.equal(a.last(), 'synced');
  assert.deepEqual(cloudData(server), mkData(4));
  assert.equal(a.cloud.getStatus().updatedAt, server.fake.db.row.updatedAt);
});

test('เครื่องใหม่ที่ยังว่าง → รับข้อมูลจากคลาวด์เลย ไม่ถามซ้ำ', async () => {
  const server = makeServer();
  await makeDevice(server, { data: mkData(4) }).cloud.enable('pw');
  const b = makeDevice(server, { pristine: true, data: mkData(0) });
  await b.cloud.enable('pw');
  assert.deepEqual(b.data, mkData(4));
  assert.equal(b.conflicts.length, 0);
  assert.equal(b.last(), 'synced');
});

test('แก้ข้อมูล → สถานะ pending แล้วส่งตอนตัวจับเวลาทำงาน', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(1) });
  await a.cloud.enable('pw');
  a.data = mkData(2);
  a.cloud.markDirty();
  assert.equal(a.last(), 'pending');
  assert.equal(a.timers.filter(Boolean).length, 1);
  assert.deepEqual(cloudData(server), mkData(1)); // ยังไม่ส่งจนกว่าจะครบเวลา
  await a.cloud.sync();
  assert.deepEqual(cloudData(server), mkData(2));
  assert.equal(a.last(), 'synced');
  assert.equal(a.cloud.getStatus().dirty, false);
});

test('เครื่องอื่นแก้ไปก่อนและเครื่องนี้ไม่มีงานค้าง → รับของใหม่มา', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(1) });
  const b = makeDevice(server, { pristine: true, data: mkData(0) });
  await a.cloud.enable('pw');
  await b.cloud.enable('pw');
  a.data = mkData(5);
  a.cloud.markDirty();
  await a.cloud.sync();
  await b.cloud.sync();
  assert.deepEqual(b.data, mkData(5));
});

test('แก้ชนกัน → ถามผู้ใช้ เลือกเครื่องนี้แล้วทับคลาวด์', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(1) });
  const b = makeDevice(server, { pristine: true, data: mkData(0) });
  await a.cloud.enable('pw');
  await b.cloud.enable('pw');
  a.data = mkData(2); a.cloud.markDirty(); await a.cloud.sync();
  b.data = mkData(3); b.cloud.markDirty();
  b.choice = 'local';
  await b.cloud.sync();
  assert.equal(b.conflicts.length, 1);
  assert.deepEqual(b.conflicts[0].cloud.data, mkData(2));
  assert.deepEqual(b.conflicts[0].local, mkData(3));
  assert.deepEqual(cloudData(server), mkData(3));
  assert.equal(b.last(), 'synced');
});

test('แก้ชนกัน → เลือกคลาวด์แล้วของเครื่องนี้ถูกแทนที่', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(1) });
  const b = makeDevice(server, { pristine: true, data: mkData(0) });
  await a.cloud.enable('pw');
  await b.cloud.enable('pw');
  a.data = mkData(2); a.cloud.markDirty(); await a.cloud.sync();
  b.data = mkData(3); b.cloud.markDirty();
  b.choice = 'cloud';
  await b.cloud.sync();
  assert.deepEqual(b.data, mkData(2));
  assert.deepEqual(cloudData(server), mkData(2));
  assert.equal(b.cloud.getStatus().dirty, false);
});

test('แก้ชนกัน → กด "ไว้ก่อน" ไม่ส่งไม่รับ และค้างสถานะ conflict', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(1) });
  const b = makeDevice(server, { pristine: true, data: mkData(0) });
  await a.cloud.enable('pw');
  await b.cloud.enable('pw');
  a.data = mkData(2); a.cloud.markDirty(); await a.cloud.sync();
  b.data = mkData(3); b.cloud.markDirty();
  b.choice = null;
  await b.cloud.sync();
  assert.equal(b.last(), 'conflict');
  assert.deepEqual(b.data, mkData(3));
  assert.deepEqual(cloudData(server), mkData(2));
  assert.equal(b.cloud.getStatus().dirty, true);
});

test('เครื่องที่มีข้อมูลอยู่แล้วเปิดซิงก์ครั้งแรกตอนคลาวด์มีข้อมูล → ถาม ไม่ทับเงียบ ๆ', async () => {
  const server = makeServer();
  await makeDevice(server, { data: mkData(7) }).cloud.enable('pw');
  const c = makeDevice(server, { pristine: false, data: mkData(1) });
  c.choice = null;
  await c.cloud.enable('pw');
  assert.equal(c.conflicts.length, 1);
  assert.deepEqual(cloudData(server), mkData(7));
});

test('รหัสผิด → ปิดซิงก์และล้างรหัสในเครื่อง', async () => {
  const server = makeServer();
  const a = makeDevice(server);
  await a.cloud.enable('wrong');
  assert.equal(a.last(), 'off:auth');
  assert.equal(a.cloud.getStatus().enabled, false);
  assert.equal(JSON.parse(a.store.get('optcg-deck-buyer.cloud')).key, '');
});

test('ออฟไลน์ → สถานะ offline และของที่ยังไม่ได้ส่งไม่หาย', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(1) });
  await a.cloud.enable('pw');
  server.down = true;
  a.data = mkData(2);
  a.cloud.markDirty();
  await a.cloud.sync();
  assert.equal(a.last(), 'offline');
  assert.equal(a.cloud.getStatus().dirty, true);
  server.down = false;
  await a.cloud.sync();
  assert.deepEqual(cloudData(server), mkData(2));
  assert.equal(a.last(), 'synced');
});

test('เว็บที่ไม่มี /api/sync (404) → unavailable', async () => {
  const server = makeServer();
  server.status404 = true;
  const a = makeDevice(server);
  await a.cloud.enable('pw');
  assert.equal(a.last(), 'unavailable');
});

test('แก้ข้อมูลระหว่างที่กำลังส่ง → ไม่ลืมของใหม่ ส่งอีกรอบ', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(1) });
  await a.cloud.enable('pw');
  a.data = mkData(2);
  a.cloud.markDirty();
  a.timers.length = 0;
  // ระหว่างรอเซิร์ฟเวอร์ตอบคำสั่งเขียน (PUT) ผู้ใช้แก้ต่อ
  server.beforeReply = (method) => {
    if (method !== 'PUT') return;
    server.beforeReply = null;
    a.data = mkData(3);
    a.cloud.markDirty();
  };
  await a.cloud.sync();
  assert.equal(a.cloud.getStatus().dirty, true);
  assert.ok(a.timers.some(Boolean), 'ต้องตั้งเวลาส่งรอบถัดไป');
  await a.cloud.sync();
  assert.deepEqual(cloudData(server), mkData(3));
  assert.equal(a.cloud.getStatus().dirty, false);
});

test('ยังไม่เปิดซิงก์ → markDirty ไม่ทำอะไร ไม่ตั้งเวลา', async () => {
  const server = makeServer();
  const a = makeDevice(server);
  a.cloud.markDirty();
  assert.equal(a.timers.length, 0);
  assert.equal(server.fake.db.calls, 0);
});

test('ปิดซิงก์ → เลิกส่ง และข้อมูลเดิมในเครื่องกับคลาวด์ยังอยู่', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(4) });
  await a.cloud.enable('pw');
  a.cloud.disable();
  assert.equal(a.last(), 'off');
  assert.deepEqual(a.data, mkData(4));
  assert.deepEqual(cloudData(server), mkData(4));
  const calls = server.fake.db.calls;
  a.cloud.markDirty();
  await a.cloud.sync();
  assert.equal(server.fake.db.calls, calls);
});

test('จำการเปิดซิงก์ไว้ข้ามการเปิดแอปใหม่ (รหัสและเวอร์ชันอยู่ใน storage)', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(2) });
  await a.cloud.enable('pw');
  // จำลองเปิดแอปใหม่ด้วย storage เดิม
  const again = create({
    getData: () => a.data, applyData: (x) => { a.data = x; }, onStatus: () => {},
    fetchImpl: (u, i) => server.fetch(u, i),
    storage: { getItem: (k) => a.store.get(k) ?? null, setItem: (k, v) => a.store.set(k, v) },
    setTimer: () => 1, clearTimer: () => {},
  });
  assert.equal(again.getStatus().enabled, true);
  assert.equal(again.getStatus().updatedAt, server.fake.db.row.updatedAt);
  await again.start();
  assert.equal(again.getStatus().status, 'synced');
});
