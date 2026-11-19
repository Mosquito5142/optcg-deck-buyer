// ฝั่งเซิร์ฟเวอร์: เก็บข้อมูลทั้งชุดเป็น JSON แถวเดียวใน Turso (ผ่าน HTTP) พร้อมประวัติไว้กู้คืน
// ใช้คนเดียว ไม่มีรหัส (ผู้ใช้เลือกเอง) — ประวัติช่วยกู้ถ้ามีใครมาลบหรือทับข้อมูล
// ชื่อไฟล์ขึ้นต้นด้วย _ เพื่อไม่ให้ Vercel เปิดเป็น endpoint
'use strict';

const MAX_BYTES = 1000000;
const HISTORY_KEEP = 50;
const SNAPSHOT_EVERY = 10 * 60 * 1000; // สำรองอัตโนมัติไม่ถี่กว่าทุก 10 นาที

const CREATE_STATE = `CREATE TABLE IF NOT EXISTS deck_state (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, edited_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`;
const CREATE_HISTORY = `CREATE TABLE IF NOT EXISTS deck_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, edited_at INTEGER NOT NULL,
  saved_at INTEGER NOT NULL, reason TEXT NOT NULL)`;
const SELECT_STATE = "SELECT data, edited_at, updated_at FROM deck_state WHERE id = 'main'";
const INSERT_STATE = `INSERT INTO deck_state (id, data, edited_at, updated_at) VALUES ('main', ?, ?, ?)
  ON CONFLICT(id) DO NOTHING`;
// เขียนได้เฉพาะเมื่อแถวยังเป็นเวอร์ชันที่เพิ่งอ่านมา (กันสองคำขอเขียนแทรกกัน)
const UPDATE_STATE = "UPDATE deck_state SET data = ?, edited_at = ?, updated_at = ? WHERE id = 'main' AND updated_at = ?";
// เก็บชุดปัจจุบันลงประวัติก่อนถูกเขียนทับ: แบบปกติเว้นช่วง 10 นาที / แบบบังคับ (ชนกัน, ก่อนกู้คืน)
const SNAPSHOT_THROTTLED = `INSERT INTO deck_history (data, edited_at, saved_at, reason)
  SELECT data, edited_at, ?, 'auto' FROM deck_state
  WHERE id = 'main' AND NOT EXISTS (SELECT 1 FROM deck_history WHERE saved_at > ?)`;
const SNAPSHOT_FORCED = `INSERT INTO deck_history (data, edited_at, saved_at, reason)
  SELECT data, edited_at, ?, ? FROM deck_state WHERE id = 'main'`;
const INSERT_HISTORY = 'INSERT INTO deck_history (data, edited_at, saved_at, reason) VALUES (?, ?, ?, ?)';
const PRUNE_HISTORY = `DELETE FROM deck_history WHERE id NOT IN (
  SELECT id FROM deck_history ORDER BY id DESC LIMIT ${HISTORY_KEEP})`;
const LIST_HISTORY = `SELECT id, data, edited_at, saved_at, reason FROM deck_history ORDER BY id DESC LIMIT ${HISTORY_KEEP}`;
const GET_HISTORY = 'SELECT id, data, edited_at, saved_at, reason FROM deck_history WHERE id = ?';

function httpUrl(dbUrl) {
  return String(dbUrl).replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');
}

function arg(v) {
  return typeof v === 'number' ? { type: 'integer', value: String(Math.trunc(v)) } : { type: 'text', value: String(v) };
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

const cell = (v) => (v.type === 'integer' ? Number(v.value) : v.value);

function readState(result) {
  const row = result.rows[0];
  if (!row) return null;
  return { data: row[0].value, editedAt: cell(row[1]), updatedAt: cell(row[2]) };
}

function isValidData(s) {
  return !!s && Array.isArray(s.sellers) && Array.isArray(s.decks) && s.decks.length > 0
    && s.decks.every((d) => d && Array.isArray(d.items) && Array.isArray(d.purchases));
}

function summarize(data) {
  const decks = data.decks || [];
  return {
    decks: decks.length,
    cards: decks.reduce((a, d) => a + d.items.reduce((b, i) => b + (Number(i.qty) || 0), 0), 0),
    placed: decks.reduce((a, d) => a + d.purchases.reduce((b, p) => b + (Number(p.qty) || 0), 0), 0),
    sellers: (data.sellers || []).length,
  };
}

const configured = (env) => env.TURSO_DATABASE_URL && env.TURSO_AUTH_TOKEN;
const NOT_CONFIGURED = { status: 500, body: { error: 'not_configured' } };

async function load(env, fetchImpl) {
  const [, , sel] = await turso(env, fetchImpl, [[CREATE_STATE], [CREATE_HISTORY], [SELECT_STATE]]);
  return readState(sel);
}

// ชนกัน (เครื่องนี้ไม่ได้เห็นเวอร์ชันล่าสุด) → ชุดที่แก้ล่าสุดชนะ ชุดที่แพ้เก็บลงประวัติ ไม่มีอะไรหาย
async function save(env, fetchImpl, now, { data, editedAt, baseUpdatedAt, restore }) {
  const text = JSON.stringify(data);
  const edited = Math.max(0, Math.trunc(Number(editedAt) || 0));
  const base = Number(baseUpdatedAt) || 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await load(env, fetchImpl);
    if (!cur) {
      const [ins] = await turso(env, fetchImpl, [[INSERT_STATE, [text, edited, now]]]);
      if (ins.affected_row_count === 1) return { status: 200, body: { result: 'saved', updatedAt: now } };
      continue;
    }

    const conflict = cur.updatedAt !== base;
    if (conflict && edited < cur.editedAt) {
      await turso(env, fetchImpl, [[INSERT_HISTORY, [text, edited, now, 'lost']], [PRUNE_HISTORY]]);
      return { status: 200, body: { result: 'stale', data: JSON.parse(cur.data), editedAt: cur.editedAt, updatedAt: cur.updatedAt } };
    }

    const version = Math.max(now, cur.updatedAt + 1);
    const reason = restore ? 'before_restore' : conflict ? 'overwritten' : null;
    const snapshot = reason ? [SNAPSHOT_FORCED, [now, reason]] : [SNAPSHOT_THROTTLED, [now, now - SNAPSHOT_EVERY]];
    const [, up] = await turso(env, fetchImpl, [snapshot, [UPDATE_STATE, [text, edited, version, cur.updatedAt]], [PRUNE_HISTORY]]);
    if (up.affected_row_count === 1) return { status: 200, body: { result: 'saved', updatedAt: version } };
  }
  return { status: 503, body: { error: 'busy' } };
}

// req: { method, body } → { status, body }
async function handleSync(req, env, { fetchImpl = fetch, now = Date.now } = {}) {
  if (!configured(env)) return NOT_CONFIGURED;
  try {
    if (req.method === 'GET') {
      const cur = await load(env, fetchImpl);
      return { status: 200, body: cur ? { data: JSON.parse(cur.data), editedAt: cur.editedAt, updatedAt: cur.updatedAt } : { data: null, editedAt: 0, updatedAt: 0 } };
    }
    if (req.method === 'PUT') {
      const body = req.body || {};
      if (!isValidData(body.data)) return { status: 400, body: { error: 'invalid_data' } };
      if (Buffer.byteLength(JSON.stringify(body.data)) > MAX_BYTES) return { status: 413, body: { error: 'too_large' } };
      return await save(env, fetchImpl, now(), body);
    }
    return { status: 405, body: { error: 'method_not_allowed' } };
  } catch (_) {
    return { status: 502, body: { error: 'database_error' } };
  }
}

// req: { method, query: { id? } } → รายการประวัติ (ไม่ส่งข้อมูลเต็ม) หรือชุดเดียวพร้อมข้อมูล
async function handleHistory(req, env, { fetchImpl = fetch } = {}) {
  if (!configured(env)) return NOT_CONFIGURED;
  if (req.method !== 'GET') return { status: 405, body: { error: 'method_not_allowed' } };
  try {
    const id = req.query && req.query.id;
    if (id !== undefined && id !== null && id !== '') {
      if (!/^\d+$/.test(String(id))) return { status: 400, body: { error: 'invalid_id' } };
      const [, , got] = await turso(env, fetchImpl, [[CREATE_STATE], [CREATE_HISTORY], [GET_HISTORY, [Number(id)]]]);
      const row = got.rows[0];
      if (!row) return { status: 404, body: { error: 'not_found' } };
      return { status: 200, body: { id: cell(row[0]), data: JSON.parse(row[1].value), editedAt: cell(row[2]), savedAt: cell(row[3]), reason: row[4].value } };
    }
    const [, , list] = await turso(env, fetchImpl, [[CREATE_STATE], [CREATE_HISTORY], [LIST_HISTORY]]);
    const items = list.rows.map((row) => ({
      id: cell(row[0]), editedAt: cell(row[2]), savedAt: cell(row[3]), reason: row[4].value,
      summary: summarize(JSON.parse(row[1].value)),
    }));
    return { status: 200, body: { items } };
  } catch (_) {
    return { status: 502, body: { error: 'database_error' } };
  }
}

module.exports = { handleSync, handleHistory, isValidData, HISTORY_KEEP, SNAPSHOT_EVERY };
