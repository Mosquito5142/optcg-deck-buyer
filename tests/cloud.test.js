const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../cloud.js');
const { handleSync, handleHistory } = require('../api/_core.js');
const { createFakeTurso } = require('./fake-turso.js');
const { migrate } = require('../sellers.js');

const ENV = { TURSO_DATABASE_URL: 'libsql://x.turso.io', TURSO_AUTH_TOKEN: 't' };
const mkData = (n) => ({ sellers: [], decks: [{ id: 'd1', name: 'x', items: [{ code: 'A', qty: n }], purchases: [] }], cards: {} });

// เซิร์ฟเวอร์จริง (api/_core.js) ต่อกับ Turso จำลอง (SQLite จริง) ใช้นาฬิกาเดียวกับทุกเครื่อง
function makeServer() {
  const fake = createFakeTurso();
  const clock = { t: 1_000_000 };
  const opts = { fetchImpl: fake.fetchImpl, now: () => clock.t };
  const server = {
    fake,
    clock,
    down: false,
    status404: false,
    beforeReply: null,
    async fetch(url, init) {
      if (server.down) throw new TypeError('network down');
      if (server.status404) return { status: 404, json: async () => ({}) };
      const u = new URL(url, 'http://x');
      const out = u.pathname === '/api/history'
        ? await handleHistory({ method: init.method, query: Object.fromEntries(u.searchParams) }, ENV, opts)
        : await handleSync({ method: init.method, body: init.body ? JSON.parse(init.body) : null }, ENV, opts);
      if (server.beforeReply) server.beforeReply(init.method);
      return { status: out.status, json: async () => out.body };
    },
    cloudData: () => JSON.parse(fake.db.all("SELECT data FROM deck_state WHERE id = 'main'")[0].data),
    history: () => fake.db.all('SELECT reason, data FROM deck_history ORDER BY id').map((r) => ({ reason: r.reason, data: JSON.parse(r.data) })),
  };
  return server;
}

function makeDevice(server, { pristine = false, data = mkData(1), store = new Map(), shouldResave, applyData } = {}) {
  const d = { data, statuses: [], notices: [], timers: [], store };
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  d.cloud = create({
    getData: () => d.data,
    applyData: (x) => (applyData ? applyData(d, x) : (d.data = x)),
    ...(shouldResave ? { shouldResave } : {}),
    isPristine: () => pristine,
    onStatus: (s, det) => d.statuses.push(det ? `${s}:${det}` : s),
    onNotice: (n) => d.notices.push(n),
    fetchImpl: (u, i) => server.fetch(u, i),
    storage,
    now: () => server.clock.t,
    setTimer: (fn) => { d.timers.push(fn); return d.timers.length; },
    clearTimer: (id) => { if (id) d.timers[id - 1] = null; },
  });
  d.last = () => d.statuses[d.statuses.length - 1];
  d.edit = (n) => { server.clock.t += 1000; d.data = mkData(n); d.cloud.markDirty(); };
  return d;
}

test('เปิดครั้งแรกตอนเซิร์ฟเวอร์ยังว่าง → บันทึกข้อมูลเครื่องนี้ขึ้นไปเลย ไม่ต้องตั้งค่าอะไร', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(4) });
  await a.cloud.start();
  assert.equal(a.last(), 'saved');
  assert.deepEqual(server.cloudData(), mkData(4));
});

test('เครื่องใหม่ที่ยังว่าง → โหลดข้อมูลจากเซิร์ฟเวอร์', async () => {
  const server = makeServer();
  await makeDevice(server, { data: mkData(4) }).cloud.start();
  const b = makeDevice(server, { pristine: true, data: mkData(0) });
  await b.cloud.start();
  assert.deepEqual(b.data, mkData(4));
  assert.deepEqual(b.notices, []);
});

test('แก้ข้อมูล → pending แล้วบันทึกเมื่อครบเวลา', async () => {
  const server = makeServer();
  const a = makeDevice(server);
  await a.cloud.start();
  a.edit(2);
  assert.equal(a.last(), 'pending');
  assert.equal(a.timers.filter(Boolean).length, 1);
  assert.deepEqual(server.cloudData(), mkData(1));
  await a.cloud.sync();
  assert.deepEqual(server.cloudData(), mkData(2));
  assert.equal(a.last(), 'saved');
});

test('เครื่องอื่นแก้ไปแล้ว เครื่องนี้ไม่มีงานค้าง → ดึงของใหม่มา', async () => {
  const server = makeServer();
  const a = makeDevice(server);
  const b = makeDevice(server, { pristine: true, data: mkData(0) });
  await a.cloud.start();
  await b.cloud.start();
  a.edit(5); await a.cloud.sync();
  await b.cloud.sync();
  assert.deepEqual(b.data, mkData(5));
});

test('ชนกัน: เครื่องนี้แก้ก่อน (ตอนออฟไลน์) → ใช้ชุดล่าสุดของเครื่องอื่น ไม่ถาม ชุดของเครื่องนี้อยู่ในประวัติ', async () => {
  const server = makeServer();
  const a = makeDevice(server);
  const b = makeDevice(server, { pristine: true, data: mkData(0) });
  await a.cloud.start();
  await b.cloud.start();
  server.down = true;
  b.edit(7); await b.cloud.sync();          // มือถือแก้ตอนไม่มีเน็ต
  assert.equal(b.last(), 'offline');
  server.down = false;
  a.edit(8); await a.cloud.sync();          // คอมแก้ทีหลัง
  await b.cloud.sync();                     // มือถือกลับมามีเน็ต
  assert.deepEqual(b.data, mkData(8));
  assert.deepEqual(b.notices, ['lost']);
  assert.deepEqual(server.cloudData(), mkData(8));
  assert.deepEqual(server.history().find((h) => h.reason === 'lost').data, mkData(7));
});

test('ชนกัน: เครื่องนี้แก้ทีหลัง → ของเครื่องนี้ชนะ ชุดเดิมของเครื่องอื่นอยู่ในประวัติ แล้วเครื่องอื่นดึงไป', async () => {
  const server = makeServer();
  const a = makeDevice(server);
  const b = makeDevice(server, { pristine: true, data: mkData(0) });
  await a.cloud.start();
  await b.cloud.start();
  a.edit(2); await a.cloud.sync();
  b.edit(3);                                 // B ยังไม่เห็นของ A แต่แก้ทีหลัง
  await b.cloud.sync();
  assert.deepEqual(server.cloudData(), mkData(3));
  assert.deepEqual(b.notices, []);
  assert.deepEqual(server.history().find((h) => h.reason === 'overwritten').data, mkData(2));
  await a.cloud.sync();
  assert.deepEqual(a.data, mkData(3));
});

test('เครื่องที่มีข้อมูลเดิม (ยังไม่เคยบันทึกขึ้นเซิร์ฟเวอร์) เจอเซิร์ฟเวอร์ที่มีข้อมูลแล้ว → ข้อมูลเดิมไม่หาย อยู่ในประวัติ', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(4) });
  await a.cloud.start();
  a.edit(5); await a.cloud.sync();
  const old = makeDevice(server, { pristine: false, data: mkData(9) }); // ข้อมูลเก่าในเครื่อง ไม่มีเวลาแก้
  await old.cloud.start();
  assert.deepEqual(old.data, mkData(5));
  assert.deepEqual(old.notices, ['lost']);
  assert.deepEqual(server.history().find((h) => h.reason === 'lost').data, mkData(9));
});

test('ออฟไลน์ → ใช้ต่อได้ งานที่ยังไม่ส่งไม่หาย และส่งเมื่อกลับมามีเน็ต', async () => {
  const server = makeServer();
  const a = makeDevice(server);
  await a.cloud.start();
  server.down = true;
  a.edit(2); await a.cloud.sync();
  assert.equal(a.last(), 'offline');
  assert.equal(a.cloud.getStatus().dirty, true);
  server.down = false;
  await a.cloud.sync();
  assert.deepEqual(server.cloudData(), mkData(2));
  assert.equal(a.last(), 'saved');
});

test('เปิดแบบไม่มีเซิร์ฟเวอร์ (404) → unavailable ข้อมูลยังอยู่ในเครื่อง', async () => {
  const server = makeServer();
  server.status404 = true;
  const a = makeDevice(server, { data: mkData(3) });
  await a.cloud.start();
  assert.equal(a.last(), 'unavailable');
  assert.deepEqual(a.data, mkData(3));
});

test('กู้คืนจากประวัติ → ใช้ในเครื่องทันที บันทึกเป็นชุดล่าสุด และสำรองชุดก่อนกู้ไว้', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(1) });
  await a.cloud.start();
  a.edit(2); await a.cloud.sync();          // สำรองอัตโนมัติ mkData(1)
  a.edit(3); await a.cloud.sync();
  const items = await a.cloud.listHistory();
  const target = items.find((i) => i.summary.cards === 1);
  assert.ok(target, 'ต้องมีชุด mkData(1) ในประวัติ');
  await a.cloud.restore(target.id);
  assert.deepEqual(a.data, mkData(1));
  assert.deepEqual(server.cloudData(), mkData(1));
  assert.equal(a.last(), 'saved');
  assert.deepEqual(server.history().find((h) => h.reason === 'before_restore').data, mkData(3));
});

test('กู้คืนตอนออฟไลน์ → แจ้ง error ข้อมูลในเครื่องไม่เปลี่ยน', async () => {
  const server = makeServer();
  const a = makeDevice(server, { data: mkData(1) });
  await a.cloud.start();
  server.down = true;
  await assert.rejects(a.cloud.restore(1), /offline/);
  await assert.rejects(a.cloud.listHistory(), /offline/);
  assert.deepEqual(a.data, mkData(1));
});

test('แก้ข้อมูลระหว่างที่กำลังส่ง → ไม่ลืมของใหม่ ส่งอีกรอบ', async () => {
  const server = makeServer();
  const a = makeDevice(server);
  await a.cloud.start();
  a.edit(2);
  a.timers.length = 0;
  server.beforeReply = (method) => {
    if (method !== 'PUT') return;
    server.beforeReply = null;
    a.edit(3);
  };
  await a.cloud.sync();
  assert.equal(a.cloud.getStatus().dirty, true);
  assert.ok(a.timers.some(Boolean), 'ต้องตั้งเวลาส่งรอบถัดไป');
  await a.cloud.sync();
  assert.deepEqual(server.cloudData(), mkData(3));
  assert.equal(a.cloud.getStatus().dirty, false);
});

test('เวอร์ชันบนเซิร์ฟเวอร์ตรงกัน แต่คนขายยังเป็นลิสต์กลาง → บันทึกชุดที่แยกต่อเด็คทับ', async () => {
  const server = makeServer();
  const old = {
    sellers: [
      { id: 'p', name: 'Pob Chaikuea', shipping: 30 },
      { id: 'm', name: 'Mee Man U', shipping: 50 },
    ],
    decks: [
      { id: 'enal', name: 'enal', items: [{ code: 'A', qty: 1 }], purchases: [{ id: '1', sellerId: 'p', code: 'A', qty: 1, price: 10 }, { id: '2', sellerId: 'm', code: 'A', qty: 1, price: 8 }] },
      { id: 'imu', name: 'imu', items: [{ code: 'B', qty: 1 }], purchases: [] },
    ],
    cards: {},
  };
  const seeded = makeDevice(server, { data: old });
  await seeded.cloud.start();
  const device = makeDevice(server, {
    data: migrate(old).state,
    store: new Map(seeded.store),
    shouldResave: (data) => migrate(data).changed,
  });
  await device.cloud.start();
  const saved = server.cloudData();
  assert.equal(saved.sellers, undefined);
  assert.deepEqual(saved.decks.map((d) => d.sellers.map((s) => s.name)), [['Pob Chaikuea', 'Mee Man U'], []]);
  assert.equal(device.cloud.getStatus().dirty, false);
});

test('เครื่องว่างรับชุดคนขายลิสต์กลาง → แยกต่อเด็คแล้วบันทึกกลับ', async () => {
  const server = makeServer();
  const old = {
    sellers: [{ id: 'p', name: 'Pob Chaikuea', shipping: 30 }],
    decks: [
      { id: 'enal', name: 'enal', items: [{ code: 'A', qty: 1 }], purchases: [{ id: '1', sellerId: 'p', code: 'A', qty: 1, price: 10 }] },
      { id: 'imu', name: 'imu', items: [], purchases: [] },
    ],
    cards: {},
  };
  await makeDevice(server, { data: old }).cloud.start();
  const fresh = makeDevice(server, {
    pristine: true,
    data: { decks: [{ id: 'new', name: 'เด็คใหม่', items: [], purchases: [], sellers: [] }], cards: {} },
    shouldResave: (data) => migrate(data).changed,
    applyData: (d, x) => {
      const moved = migrate({ cards: {}, ...x });
      d.data = moved.state;
      return moved.changed;
    },
  });
  await fresh.cloud.start();
  assert.equal(fresh.cloud.getStatus().dirty, true);
  await fresh.cloud.sync();
  const saved = server.cloudData();
  assert.equal(saved.sellers, undefined);
  assert.deepEqual(saved.decks.map((d) => d.sellers.map((s) => s.name)), [['Pob Chaikuea'], []]);
  assert.equal(fresh.last(), 'saved');
});

test('จำเวอร์ชันและงานค้างไว้ข้ามการเปิดแอปใหม่', async () => {
  const server = makeServer();
  const store = new Map();
  const a = makeDevice(server, { data: mkData(2), store });
  await a.cloud.start();
  server.down = true;
  a.edit(6); await a.cloud.sync();
  server.down = false;
  const again = makeDevice(server, { data: a.data, store }); // เปิดแอปใหม่ storage เดิม
  assert.equal(again.cloud.getStatus().dirty, true);
  await again.cloud.start();
  assert.deepEqual(server.cloudData(), mkData(6));
  assert.equal(again.last(), 'saved');
});
