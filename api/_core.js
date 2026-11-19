// ฝั่งเซิร์ฟเวอร์ของการซิงก์: เก็บข้อมูลทั้งชุดเป็น JSON แถวเดียวใน Turso (ผ่าน HTTP)
// token ของ Turso และรหัสซิงก์อยู่ใน environment ของโฮสต์เท่านั้น ไม่เคยส่งถึงเบราว์เซอร์
// ชื่อไฟล์ขึ้นต้นด้วย _ เพื่อไม่ให้ Vercel เปิดเป็น endpoint
'use strict';

const crypto = require('node:crypto');

const ROW_ID = 'main';
const MAX_BYTES = 1000000;

const CREATE = 'CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)';
const SELECT = 'SELECT data, updated_at FROM app_state WHERE id = ?';
// เขียนได้เมื่อเวอร์ชันในฐานข้อมูลตรงกับที่ไคลเอนต์รู้ (กันเครื่องหนึ่งทับงานอีกเครื่อง) ทำในคำสั่งเดียวจึงไม่มีช่วงให้แทรก
const UPSERT = `INSERT INTO app_state (id, data, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = MAX(excluded.updated_at, app_state.updated_at + 1)
  WHERE app_state.updated_at = ?`;

function digest(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

// เทียบแบบเวลาคงที่ กันเดารหัสจากเวลาตอบ
function sameSecret(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

function httpUrl(dbUrl) {
  return String(dbUrl).replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');
}

function arg(v) {
  return typeof v === 'number' ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) };
}

// รันหลายคำสั่งต่อเนื่องใน stream เดียว (ลำดับแน่นอน) คืน result ของแต่ละคำสั่ง
async function turso(env, fetchImpl, statements) {
  const requests = statements.map(([sql, args = []]) => ({ type: 'execute', stmt: { sql, args: args.map(arg) } }));
  requests.push({ type: 'close' });
  const res = await fetchImpl(`${httpUrl(env.TURSO_DATABASE_URL)}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) throw new Error(`turso http ${res.status}`);
  const json = await res.json();
  return json.results.slice(0, statements.length).map((r) => {
    if (r.type !== 'ok') throw new Error((r.error && r.error.message) || 'turso error');
    return r.response.result;
  });
}

function readRow(result) {
  const row = result.rows[0];
  if (!row) return { data: null, updatedAt: 0 };
  return { data: JSON.parse(row[0].value), updatedAt: Number(row[1].value) };
}

function isValidData(s) {
  return !!s && Array.isArray(s.sellers) && Array.isArray(s.decks) && s.decks.length > 0
    && s.decks.every((d) => d && Array.isArray(d.items) && Array.isArray(d.purchases));
}

// req: { method, headers (ตัวพิมพ์เล็ก), body } → { status, body }
async function handleSync(req, env, fetchImpl = fetch) {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN || !env.SYNC_PASSWORD) {
    return { status: 500, body: { error: 'not_configured' } };
  }
  const key = req.headers && req.headers['x-sync-key'];
  if (!key || !sameSecret(key, env.SYNC_PASSWORD)) return { status: 401, body: { error: 'unauthorized' } };

  try {
    if (req.method === 'GET') {
      const [, sel] = await turso(env, fetchImpl, [[CREATE], [SELECT, [ROW_ID]]]);
      return { status: 200, body: readRow(sel) };
    }

    if (req.method === 'PUT') {
      const { data, baseUpdatedAt } = req.body || {};
      if (!isValidData(data)) return { status: 400, body: { error: 'invalid_data' } };
      const text = JSON.stringify(data);
      if (Buffer.byteLength(text) > MAX_BYTES) return { status: 413, body: { error: 'too_large' } };
      const base = Number(baseUpdatedAt) || 0;
      const [, up, sel] = await turso(env, fetchImpl, [
        [CREATE],
        [UPSERT, [ROW_ID, text, Date.now(), base]],
        [SELECT, [ROW_ID]],
      ]);
      const row = readRow(sel);
      if (up.affected_row_count === 0) return { status: 409, body: { error: 'conflict', ...row } };
      return { status: 200, body: { updatedAt: row.updatedAt } };
    }

    return { status: 405, body: { error: 'method_not_allowed' } };
  } catch (_) {
    return { status: 502, body: { error: 'database_error' } };
  }
}

module.exports = { handleSync, isValidData };
