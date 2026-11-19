const test = require('node:test');
const assert = require('node:assert/strict');
const { handleSync } = require('../api/_core.js');
const { createFakeTurso } = require('./fake-turso.js');

const ENV = { TURSO_DATABASE_URL: 'libsql://deck-me.aws-ap-northeast-1.turso.io', TURSO_AUTH_TOKEN: 'secret-token', SYNC_PASSWORD: 'correct horse' };
const goodHeaders = { 'x-sync-key': 'correct horse' };
const sample = (n = 1) => ({ sellers: [], decks: [{ id: 'd1', name: 'x', items: [{ code: 'A', qty: n }], purchases: [] }], cards: {} });

function setup() {
  const fake = createFakeTurso();
  const call = (req, env = ENV) => handleSync(req, env, fake.fetchImpl);
  return { fake, call };
}

test('ตั้งค่าไม่ครบ → 500 ไม่ยุ่งกับฐานข้อมูล', async () => {
  const { fake, call } = setup();
  const r = await call({ method: 'GET', headers: goodHeaders }, { ...ENV, TURSO_AUTH_TOKEN: '' });
  assert.equal(r.status, 500);
  assert.equal(fake.db.calls, 0);
});

test('ไม่มีรหัสหรือรหัสผิด → 401 และไม่แตะฐานข้อมูล', async () => {
  const { fake, call } = setup();
  assert.equal((await call({ method: 'GET', headers: {} })).status, 401);
  assert.equal((await call({ method: 'GET', headers: { 'x-sync-key': 'wrong' } })).status, 401);
  assert.equal((await call({ method: 'PUT', headers: { 'x-sync-key': 'correct horsE' }, body: { data: sample() } })).status, 401);
  assert.equal(fake.db.calls, 0);
});

test('GET ตอนยังว่าง → data null และแปลง libsql:// เป็น https:// พร้อม token', async () => {
  const { fake, call } = setup();
  const r = await call({ method: 'GET', headers: goodHeaders });
  assert.deepEqual(r, { status: 200, body: { data: null, updatedAt: 0 } });
  assert.equal(fake.db.lastUrl, 'https://deck-me.aws-ap-northeast-1.turso.io/v2/pipeline');
  assert.equal(fake.db.lastAuth, 'Bearer secret-token');
});

test('PUT ครั้งแรกแล้ว GET ได้ข้อมูลเดิมพร้อมเวอร์ชันเดียวกัน', async () => {
  const { call } = setup();
  const put = await call({ method: 'PUT', headers: goodHeaders, body: { data: sample(3), baseUpdatedAt: 0 } });
  assert.equal(put.status, 200);
  assert.ok(put.body.updatedAt > 0);
  const get = await call({ method: 'GET', headers: goodHeaders });
  assert.deepEqual(get.body, { data: sample(3), updatedAt: put.body.updatedAt });
});

test('PUT ที่อิงเวอร์ชันเก่า → 409 พร้อมข้อมูลปัจจุบัน และไม่ทับของเดิม', async () => {
  const { fake, call } = setup();
  const first = await call({ method: 'PUT', headers: goodHeaders, body: { data: sample(1), baseUpdatedAt: 0 } });
  const second = await call({ method: 'PUT', headers: goodHeaders, body: { data: sample(2), baseUpdatedAt: first.body.updatedAt } });
  assert.equal(second.status, 200);
  assert.ok(second.body.updatedAt > first.body.updatedAt);

  const stale = await call({ method: 'PUT', headers: goodHeaders, body: { data: sample(9), baseUpdatedAt: first.body.updatedAt } });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body, { error: 'conflict', data: sample(2), updatedAt: second.body.updatedAt });
  assert.deepEqual(JSON.parse(fake.db.row.data), sample(2));

  // เครื่องที่ไม่เคยซิงก์ (base 0) ก็ทับของที่มีอยู่ไม่ได้
  const fresh = await call({ method: 'PUT', headers: goodHeaders, body: { data: sample(7), baseUpdatedAt: 0 } });
  assert.equal(fresh.status, 409);
});

test('ข้อมูลผิดรูปแบบ → 400, ใหญ่เกิน → 413', async () => {
  const { fake, call } = setup();
  assert.equal((await call({ method: 'PUT', headers: goodHeaders, body: { data: { sellers: [] } } })).status, 400);
  assert.equal((await call({ method: 'PUT', headers: goodHeaders, body: null })).status, 400);
  const big = sample();
  big.cards = { x: 'a'.repeat(1100000) };
  assert.equal((await call({ method: 'PUT', headers: goodHeaders, body: { data: big } })).status, 413);
  assert.equal(fake.db.row, null);
});

test('Turso ล่ม → 502 โดยไม่ส่งรายละเอียดภายในกลับไป', async () => {
  const { fake, call } = setup();
  fake.db.failNext = true;
  const r = await call({ method: 'GET', headers: goodHeaders });
  assert.deepEqual(r, { status: 502, body: { error: 'database_error' } });
});

test('method อื่น → 405', async () => {
  const { call } = setup();
  assert.equal((await call({ method: 'DELETE', headers: goodHeaders })).status, 405);
});
