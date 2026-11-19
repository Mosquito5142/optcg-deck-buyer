// Turso จำลอง: รับ /v2/pipeline แล้วรัน SQL จริงบน SQLite ในหน่วยความจำ (node:sqlite) ไม่ใช่ไฟล์เทส
'use strict';

const { DatabaseSync } = require('node:sqlite');

function createFakeTurso() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    calls: 0,
    failNext: false,
    lastUrl: null,
    lastAuth: null,
    all: (sql, ...args) => sqlite.prepare(sql).all(...args).map((row) => ({ ...row })), // แถวของ node:sqlite ไม่มี prototype
  };

  const toValue = (v) => {
    if (v === null || v === undefined) return { type: 'null' };
    if (typeof v === 'bigint') return { type: 'integer', value: String(v) };
    if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
    return { type: 'text', value: String(v) };
  };
  const fromArg = (a) => (a.type === 'integer' ? Number(a.value) : a.type === 'null' ? null : a.value);

  async function fetchImpl(url, init) {
    db.calls++;
    db.lastUrl = url;
    db.lastAuth = init.headers.Authorization;
    if (db.failNext) { db.failNext = false; return { ok: false, status: 503, json: async () => ({}) }; }

    const { requests } = JSON.parse(init.body);
    const results = requests.map((r) => {
      if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
      try {
        const stmt = sqlite.prepare(r.stmt.sql);
        const args = (r.stmt.args || []).map(fromArg);
        if (/^\s*SELECT/i.test(r.stmt.sql)) {
          const rows = stmt.all(...args).map((row) => Object.values(row).map(toValue));
          return { type: 'ok', response: { type: 'execute', result: { cols: [], rows, affected_row_count: 0 } } };
        }
        const info = stmt.run(...args);
        return { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: Number(info.changes) } } };
      } catch (e) {
        return { type: 'error', error: { message: e.message } };
      }
    });
    return { ok: true, status: 200, json: async () => ({ results }) };
  }

  return { db, fetchImpl };
}

module.exports = { createFakeTurso };
