const test = require('node:test');
const assert = require('node:assert/strict');
const { handleSync, handleHistory, HISTORY_KEEP, SNAPSHOT_EVERY } = require('../api/_core.js');
const { createFakeTurso } = require('./fake-turso.js');

const ENV = { TURSO_DATABASE_URL: 'libsql://deck-me.aws-ap-northeast-1.turso.io', TURSO_AUTH_TOKEN: 'secret-token' };
const sample = (n = 1) => ({ sellers: [], decks: [{ id: 'd1', name: 'x', items: [{ code: 'A', qty: n }], purchases: [] }], cards: {} });
const MIN = 60 * 1000;

function setup() {
  const fake = createFakeTurso();
  const clock = { t: 1_000_000 };
  const opts = { fetchImpl: fake.fetchImpl, now: () => clock.t };
  return {
    fake,
    clock,
    get: () => handleSync({ method: 'GET' }, ENV, opts),
    put: (body) => handleSync({ method: 'PUT', body }, ENV, opts),
    history: (query = {}) => handleHistory({ method: 'GET', query }, ENV, opts),
    rows: () => fake.db.all('SELECT reason, edited_at FROM deck_history ORDER BY id'),
  };
}

test('ตั้งค่าไม่ครบ → 500 ไม่ยุ่งกับฐานข้อมูล', async () => {
  const s = setup();
  const r = await handleSync({ method: 'GET' }, { ...ENV, TURSO_AUTH_TOKEN: '' }, { fetchImpl: s.fake.fetchImpl });
  assert.deepEqual(r, { status: 500, body: { error: 'not_configured' } });
  assert.equal((await handleHistory({ method: 'GET' }, {}, {})).status, 500);
  assert.equal(s.fake.db.calls, 0);
});

test('ไม่ต้องมีรหัส · GET ตอนยังว่าง → data null และใช้ https:// พร้อม token ของ Turso', async () => {
  const s = setup();
  assert.deepEqual(await s.get(), { status: 200, body: { data: null, editedAt: 0, updatedAt: 0 } });
  assert.equal(s.fake.db.lastUrl, 'https://deck-me.aws-ap-northeast-1.turso.io/v2/pipeline');
  assert.equal(s.fake.db.lastAuth, 'Bearer secret-token');
});

test('บันทึกครั้งแรกแล้วอ่านกลับได้ พร้อมเวลาแก้', async () => {
  const s = setup();
  const put = await s.put({ data: sample(3), editedAt: 500, baseUpdatedAt: 0 });
  assert.deepEqual(put, { status: 200, body: { result: 'saved', updatedAt: s.clock.t } });
  assert.deepEqual((await s.get()).body, { data: sample(3), editedAt: 500, updatedAt: s.clock.t });
});

test('บันทึกต่อเนื่อง: สำรองชุดก่อนหน้าลงประวัติไม่ถี่กว่าทุก 10 นาที', async () => {
  const s = setup();
  let v = (await s.put({ data: sample(1), editedAt: 1, baseUpdatedAt: 0 })).body.updatedAt;
  s.clock.t += MIN;
  v = (await s.put({ data: sample(2), editedAt: 2, baseUpdatedAt: v })).body.updatedAt;
  s.clock.t += MIN;
  v = (await s.put({ data: sample(3), editedAt: 3, baseUpdatedAt: v })).body.updatedAt;
  assert.deepEqual(s.rows(), [{ reason: 'auto', edited_at: 1 }]); // สำรองแค่ครั้งเดียวในช่วง 10 นาที
  s.clock.t += SNAPSHOT_EVERY + MIN;
  await s.put({ data: sample(4), editedAt: 4, baseUpdatedAt: v });
  assert.deepEqual(s.rows(), [{ reason: 'auto', edited_at: 1 }, { reason: 'auto', edited_at: 3 }]);
  assert.deepEqual((await s.get()).body.data, sample(4));
});

test('ชนกันและชุดที่ส่งมาแก้ทีหลัง → ชนะ ชุดเดิมในคลาวด์เก็บลงประวัติ (overwritten)', async () => {
  const s = setup();
  const v1 = (await s.put({ data: sample(1), editedAt: 100, baseUpdatedAt: 0 })).body.updatedAt;
  s.clock.t += 1000;
  await s.put({ data: sample(2), editedAt: 200, baseUpdatedAt: v1 }); // เครื่อง A
  s.clock.t += 1000;
  const r = await s.put({ data: sample(3), editedAt: 300, baseUpdatedAt: v1 }); // เครื่อง B ไม่เห็นของ A แต่แก้ทีหลัง
  assert.equal(r.body.result, 'saved');
  assert.deepEqual((await s.get()).body.data, sample(3));
  assert.deepEqual(s.rows().at(-1), { reason: 'overwritten', edited_at: 200 });
});

test('ชนกันและชุดที่ส่งมาเก่ากว่า → ได้ข้อมูลล่าสุดกลับไป ชุดที่ส่งมาเก็บลงประวัติ (lost)', async () => {
  const s = setup();
  const v1 = (await s.put({ data: sample(1), editedAt: 100, baseUpdatedAt: 0 })).body.updatedAt;
  s.clock.t += 1000;
  const v2 = (await s.put({ data: sample(2), editedAt: 300, baseUpdatedAt: v1 })).body.updatedAt;
  s.clock.t += 1000;
  const r = await s.put({ data: sample(9), editedAt: 200, baseUpdatedAt: v1 }); // แก้ตอนออฟไลน์ ก่อน 300
  assert.deepEqual(r, { status: 200, body: { result: 'stale', data: sample(2), editedAt: 300, updatedAt: v2 } });
  assert.deepEqual((await s.get()).body.data, sample(2));
  assert.deepEqual(s.rows().at(-1), { reason: 'lost', edited_at: 200 });
  const lost = await s.history({ id: s.fake.db.all("SELECT id FROM deck_history WHERE reason = 'lost'")[0].id });
  assert.deepEqual(lost.body.data, sample(9));
});

test('ข้อมูลเก่าที่ไม่มีเวลาแก้ (0) สองเครื่อง → ชุดที่ส่งทีหลังชนะ แต่ชุดแรกยังอยู่ในประวัติ', async () => {
  const s = setup();
  await s.put({ data: sample(1), editedAt: 0, baseUpdatedAt: 0 });
  s.clock.t += 1000;
  const r = await s.put({ data: sample(2), editedAt: 0, baseUpdatedAt: 0 });
  assert.equal(r.body.result, 'saved');
  assert.deepEqual(s.rows(), [{ reason: 'overwritten', edited_at: 0 }]);
});

test('กู้คืน (restore) → สำรองชุดปัจจุบันเสมอแม้ยังไม่ครบ 10 นาที', async () => {
  const s = setup();
  let v = (await s.put({ data: sample(1), editedAt: 1, baseUpdatedAt: 0 })).body.updatedAt;
  s.clock.t += MIN;
  v = (await s.put({ data: sample(2), editedAt: 2, baseUpdatedAt: v })).body.updatedAt; // auto snapshot ของ sample(1)
  s.clock.t += MIN;
  await s.put({ data: sample(1), editedAt: 3, baseUpdatedAt: v, restore: true });
  assert.deepEqual(s.rows(), [{ reason: 'auto', edited_at: 1 }, { reason: 'before_restore', edited_at: 2 }]);
  assert.deepEqual((await s.get()).body.data, sample(1));
});

test(`ประวัติเก็บล่าสุด ${HISTORY_KEEP} ชุด`, async () => {
  const s = setup();
  let v = (await s.put({ data: sample(0), editedAt: 1, baseUpdatedAt: 0 })).body.updatedAt;
  for (let i = 1; i <= HISTORY_KEEP + 5; i++) {
    s.clock.t += SNAPSHOT_EVERY + 1;
    v = (await s.put({ data: sample(i), editedAt: i + 1, baseUpdatedAt: v })).body.updatedAt;
  }
  const count = s.fake.db.all('SELECT COUNT(*) AS n FROM deck_history')[0].n;
  assert.equal(count, HISTORY_KEEP);
});

test('รายการประวัติ: ใหม่สุดก่อน มีสรุป ไม่ส่งข้อมูลเต็ม · ดึงทีละชุดได้ · ไม่มี → 404', async () => {
  const s = setup();
  const withBuys = { ...sample(4), sellers: [{ id: 's1', name: 'A', shipping: 0 }] };
  withBuys.decks[0].purchases = [{ id: 'p', sellerId: 's1', code: 'A', qty: 3, price: 1 }];
  let v = (await s.put({ data: withBuys, editedAt: 1, baseUpdatedAt: 0 })).body.updatedAt;
  s.clock.t += SNAPSHOT_EVERY + 1;
  v = (await s.put({ data: sample(2), editedAt: 2, baseUpdatedAt: v })).body.updatedAt;
  s.clock.t += SNAPSHOT_EVERY + 1;
  await s.put({ data: sample(3), editedAt: 3, baseUpdatedAt: v });

  const list = await s.history();
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 2);
  assert.ok(list.body.items[0].id > list.body.items[1].id);
  assert.deepEqual(list.body.items[1].summary, { decks: 1, cards: 4, placed: 3, sellers: 1 });
  assert.equal(list.body.items[0].data, undefined);

  const one = await s.history({ id: String(list.body.items[1].id) });
  assert.deepEqual(one.body.data, withBuys);
  assert.equal(one.body.reason, 'auto');
  assert.equal((await s.history({ id: '999' })).status, 404);
  assert.equal((await s.history({ id: '1;DROP' })).status, 400);
});

test('ข้อมูลผิดรูปแบบ → 400, ใหญ่เกิน → 413, method อื่น → 405', async () => {
  const s = setup();
  assert.equal((await s.put({ data: { sellers: [] } })).status, 400);
  assert.equal((await handleSync({ method: 'PUT', body: null }, ENV, { fetchImpl: s.fake.fetchImpl })).status, 400);
  const big = sample();
  big.cards = { x: 'a'.repeat(1100000) };
  assert.equal((await s.put({ data: big })).status, 413);
  assert.equal((await handleSync({ method: 'DELETE' }, ENV, { fetchImpl: s.fake.fetchImpl })).status, 405);
  assert.equal((await handleHistory({ method: 'POST' }, ENV, { fetchImpl: s.fake.fetchImpl })).status, 405);
  assert.equal((await s.get()).body.data, null);
});

test('Turso ล่ม → 502 โดยไม่ส่งรายละเอียดภายในกลับไป', async () => {
  const s = setup();
  s.fake.db.failNext = true;
  assert.deepEqual(await s.get(), { status: 502, body: { error: 'database_error' } });
});
