// ซิงก์ข้ามเครื่อง: ข้อมูลในเบราว์เซอร์ยังเป็นหลัก แล้วส่งขึ้น /api/sync (Turso) ตามหลัง
// หลักการ: ทุกการเขียนอิงเวอร์ชันที่เครื่องนี้เห็นล่าสุด ถ้าเครื่องอื่นเขียนไปก่อนจะไม่ทับเงียบ ๆ แต่ถามผู้ใช้
(function (root) {
  'use strict';

  const META_KEY = 'optcg-deck-buyer.cloud';
  const PUSH_DELAY = 1500;

  // สถานะ: off | idle | syncing | synced | pending | offline | conflict | unavailable | error
  function create(opts) {
    const {
      getData,                                  // () => ข้อมูลทั้งชุดที่จะส่ง
      applyData,                                // (data) => ใช้ข้อมูลจากคลาวด์แทนของเครื่องนี้
      isPristine = () => false,                 // เครื่องนี้ยังว่างเปล่า (ยังไม่เคยใช้) ไหม
      onStatus = () => {},
      resolveConflict = async () => null,       // ({ cloud, local }) => 'cloud' | 'local' | null
      fetchImpl = (...a) => root.fetch(...a),
      storage = root.localStorage,
      setTimer = (fn, ms) => root.setTimeout(fn, ms),
      clearTimer = (id) => root.clearTimeout(id),
      endpoint = '/api/sync',
    } = opts;

    let meta = loadMeta();
    let status = meta.key ? 'idle' : 'off';
    let detail = '';
    let timer = null;
    let running = null;
    let rerun = false;
    let rev = 0;           // เพิ่มทุกครั้งที่แก้ข้อมูล ใช้ดูว่ามีการแก้ระหว่างที่กำลังส่งอยู่ไหม

    function loadMeta() {
      try {
        const m = JSON.parse(storage.getItem(META_KEY));
        if (m && typeof m.key === 'string' && m.key) return { key: m.key, updatedAt: Number(m.updatedAt) || 0, dirty: !!m.dirty };
      } catch (_) { /* ไม่มีหรืออ่านไม่ได้ = ยังไม่เปิดซิงก์ */ }
      return { key: '', updatedAt: 0, dirty: false };
    }

    function saveMeta() {
      try { storage.setItem(META_KEY, JSON.stringify(meta)); } catch (_) { /* บันทึกสถานะไม่ได้ก็ไม่เป็นไร รอบหน้าถามใหม่ */ }
    }

    function set(s, d = '') {
      status = s;
      detail = d;
      onStatus(s, d);
    }

    async function call(method, body) {
      let res;
      try {
        res = await fetchImpl(endpoint, {
          method,
          headers: { 'x-sync-key': meta.key, 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (_) {
        return { net: true };
      }
      let json = null;
      try { json = await res.json(); } catch (_) { /* ตอบไม่ใช่ JSON */ }
      return { status: res.status, json: json || {} };
    }

    function rejected() {
      meta = { key: '', updatedAt: 0, dirty: false };
      saveMeta();
      set('off', 'auth');
    }

    function take(cloud) {
      applyData(cloud.data);
      meta.updatedAt = cloud.updatedAt;
      meta.dirty = false;
      saveMeta();
      set('synced');
    }

    async function push(base) {
      const sentRev = rev;
      const res = await call('PUT', { data: getData(), baseUpdatedAt: base });
      if (res.net) { set('offline'); return; }
      if (res.status === 401) { rejected(); return; }
      if (res.status === 409) { await conflict(res.json); return; }
      if (res.status !== 200) { set('error', res.json.error || String(res.status)); return; }
      meta.updatedAt = res.json.updatedAt;
      meta.dirty = rev !== sentRev;          // แก้ซ้ำระหว่างส่ง → ยังมีของใหม่ที่ต้องส่งอีกรอบ
      saveMeta();
      if (meta.dirty) { set('pending'); schedule(); } else set('synced');
    }

    async function conflict(cloud) {
      set('conflict');
      const choice = await resolveConflict({ cloud, local: getData() });
      if (choice === 'cloud') take(cloud);
      else if (choice === 'local') await push(cloud.updatedAt);
      // ไม่เลือก: ค้างสถานะ conflict ไว้ ไม่ส่งและไม่รับอะไร
    }

    async function run() {
      set('syncing');
      const got = await call('GET');
      if (got.net) { set('offline'); return; }
      if (got.status === 401) { rejected(); return; }
      if (got.status === 404) { set('unavailable'); return; }
      if (got.status !== 200) { set('error', got.json.error || String(got.status)); return; }

      const cloud = got.json;
      if (cloud.data === null || cloud.data === undefined) { await push(0); return; }
      if (cloud.updatedAt === meta.updatedAt) {
        if (meta.dirty) await push(meta.updatedAt); else set('synced');
        return;
      }
      // คลาวด์เปลี่ยนไปจากที่เครื่องนี้รู้: ถ้าเครื่องนี้ไม่มีงานค้าง (หรือเพิ่งเปิดใช้แล้วยังว่าง) รับมาเลย
      if (!meta.dirty && (meta.updatedAt > 0 || isPristine())) { take(cloud); return; }
      await conflict(cloud);
    }

    function sync() {
      if (!meta.key) return Promise.resolve();
      if (running) { rerun = true; return running; }
      running = (async () => {
        try {
          do {
            rerun = false;
            await run();
          } while (rerun && status !== 'conflict');
        } finally {
          running = null;
        }
      })();
      return running;
    }

    function schedule() {
      clearTimer(timer);
      timer = setTimer(() => { timer = null; sync(); }, PUSH_DELAY);
    }

    function markDirty() {
      if (!meta.key) return;
      rev++;
      meta.dirty = true;
      saveMeta();
      if (status === 'synced' || status === 'idle') set('pending');
      schedule();
    }

    function enable(key) {
      meta = { key: String(key || '').trim(), updatedAt: 0, dirty: false };
      if (!meta.key) { set('off'); return Promise.resolve(); }
      saveMeta();
      set('idle');
      return sync();
    }

    function disable() {
      clearTimer(timer);
      timer = null;
      meta = { key: '', updatedAt: 0, dirty: false };
      saveMeta();
      set('off');
    }

    function start() {
      if (meta.key) { onStatus(status, detail); return sync(); }
      return Promise.resolve();
    }

    function getStatus() {
      return { status, detail, enabled: !!meta.key, updatedAt: meta.updatedAt, dirty: meta.dirty };
    }

    return { enable, disable, markDirty, sync, start, getStatus };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cloud = api;
})(typeof window !== 'undefined' ? window : globalThis);
