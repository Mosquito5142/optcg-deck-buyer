// Turso จำลองในหน่วยความจำ รับ /v2/pipeline แล้วทำตามคำสั่งที่ api/_core.js ส่งมา (ไม่ใช่ไฟล์เทส)
'use strict';

function createFakeTurso() {
  const db = { row: null, calls: 0, failNext: false, lastUrl: null, lastAuth: null };
  const text = (v) => ({ type: 'text', value: v });
  const int = (v) => ({ type: 'integer', value: String(v) });

  async function fetchImpl(url, init) {
    db.calls++;
    db.lastUrl = url;
    db.lastAuth = init.headers.Authorization;
    if (db.failNext) { db.failNext = false; return { ok: false, status: 503, json: async () => ({}) }; }

    const { requests } = JSON.parse(init.body);
    const results = requests.map((r) => {
      if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
      const { sql, args } = r.stmt;
      const a = args.map((x) => x.value);
      const result = { cols: [], rows: [], affected_row_count: 0 };
      if (/^\s*CREATE TABLE/i.test(sql)) {
        // ตารางมีอยู่แล้วหรือสร้างใหม่ ไม่ต้องทำอะไร
      } else if (/^\s*SELECT/i.test(sql)) {
        if (db.row) result.rows = [[text(db.row.data), int(db.row.updatedAt)]];
      } else if (/^\s*INSERT/i.test(sql)) {
        const [, data, now, base] = a;
        if (!db.row) {
          db.row = { data, updatedAt: Number(now) };
          result.affected_row_count = 1;
        } else if (db.row.updatedAt === Number(base)) {
          db.row = { data, updatedAt: Math.max(Number(now), db.row.updatedAt + 1) };
          result.affected_row_count = 1;
        }
      } else {
        return { type: 'error', error: { message: 'unexpected sql' } };
      }
      return { type: 'ok', response: { type: 'execute', result } };
    });
    return { ok: true, status: 200, json: async () => ({ results }) };
  }

  return { db, fetchImpl };
}

module.exports = { createFakeTurso };
