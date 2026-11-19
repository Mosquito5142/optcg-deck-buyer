// บันทึกขึ้นเซิร์ฟเวอร์ (Turso ผ่าน /api/sync) อัตโนมัติ: ข้อมูลในเบราว์เซอร์ยังอยู่ ไม่มีเน็ตก็ใช้ต่อได้
// ชนกันระหว่างเครื่อง → เซิร์ฟเวอร์ให้ชุดที่ "แก้ล่าสุด" ชนะ ชุดที่แพ้เก็บลงประวัติ กู้คืนได้ (ไม่ถามผู้ใช้)
(function (root) {
  'use strict';

  const META_KEY = 'optcg-deck-buyer.save';
  const PUSH_DELAY = 1500;

  // สถานะ: idle | saving | saved | pending | offline | unavailable | error
  function create(opts) {
    const {
      getData,                                  // () => ข้อมูลทั้งชุดที่จะบันทึก
      applyData,                                // (data) => ใช้ข้อมูลจากเซิร์ฟเวอร์แทนของเครื่องนี้
      isPristine = () => false,                 // เครื่องนี้ยังว่าง (ยังไม่เคยใช้) ไหม
      onStatus = () => {},
      onNotice = () => {},                      // ('lost') = ใช้ชุดล่าสุดจากเครื่องอื่นแทน ชุดของเครื่องนี้อยู่ในประวัติ
      fetchImpl = (...a) => root.fetch(...a),
      storage = root.localStorage,
      setTimer = (fn, ms) => root.setTimeout(fn, ms),
      clearTimer = (id) => root.clearTimeout(id),
      now = () => Date.now(),
      endpoint = '/api/sync',
      historyEndpoint = '/api/history',
    } = opts;

    let meta = loadMeta();
    let status = 'idle';
    let detail = '';
    let timer = null;
    let running = null;
    let rerun = false;
    let rev = 0;            // เพิ่มทุกครั้งที่แก้ ใช้ดูว่ามีการแก้ระหว่างที่กำลังส่งอยู่ไหม
    let restoring = false;  // ส่งรอบถัดไปเป็นการกู้คืน (ให้เซิร์ฟเวอร์สำรองชุดปัจจุบันก่อนเสมอ)

    function loadMeta() {
      try {
        const m = JSON.parse(storage.getItem(META_KEY));
        if (m) return { updatedAt: Number(m.updatedAt) || 0, editedAt: Number(m.editedAt) || 0, dirty: !!m.dirty };
      } catch (_) { /* ยังไม่เคยบันทึกขึ้นเซิร์ฟเวอร์ */ }
      return { updatedAt: 0, editedAt: 0, dirty: false };
    }

    function saveMeta() {
      try { storage.setItem(META_KEY, JSON.stringify(meta)); } catch (_) { /* จำไม่ได้ก็แค่เทียบใหม่รอบหน้า */ }
    }

    function set(s, d = '') {
      status = s;
      detail = d;
      onStatus(s, d);
    }

    async function call(method, url, body) {
      let res;
      try {
        res = await fetchImpl(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (_) {
        return { net: true };
      }
      let json = null;
      try { json = await res.json(); } catch (_) { /* ตอบไม่ใช่ JSON */ }
      return { status: res.status, json: json || {} };
    }

    function failed(res) {
      if (res.net) set('offline');
      else if (res.status === 404) set('unavailable');
      else set('error', res.json.error || String(res.status));
    }

    function take(cloud) {
      applyData(cloud.data);
      meta = { updatedAt: cloud.updatedAt, editedAt: cloud.editedAt, dirty: false };
      saveMeta();
      set('saved');
    }

    async function push() {
      const sentRev = rev;
      const restore = restoring;
      const res = await call('PUT', endpoint, { data: getData(), editedAt: meta.editedAt, baseUpdatedAt: meta.updatedAt, restore });
      if (res.net || res.status !== 200) { failed(res); return; }
      if (restore) restoring = false;
      if (res.json.result === 'stale') {
        take(res.json);
        onNotice('lost');
        return;
      }
      meta.updatedAt = res.json.updatedAt;
      meta.dirty = rev !== sentRev;          // แก้ซ้ำระหว่างส่ง → ยังมีของใหม่ต้องส่งอีกรอบ
      saveMeta();
      if (meta.dirty) { set('pending'); schedule(); } else set('saved');
    }

    async function run() {
      set('saving');
      const got = await call('GET', endpoint);
      if (got.net || got.status !== 200) { failed(got); return; }
      const cloud = got.json;
      if (cloud.data === null || cloud.data === undefined) { await push(); return; }
      if (cloud.updatedAt === meta.updatedAt) {
        if (meta.dirty) await push(); else set('saved');
        return;
      }
      // เซิร์ฟเวอร์เปลี่ยนไปจากที่เครื่องนี้รู้: ไม่มีงานค้าง (หรือเครื่องยังว่าง) → รับมา, มีงานค้าง → ส่งให้เซิร์ฟเวอร์ตัดสินด้วยเวลาแก้
      if (!meta.dirty && (meta.updatedAt > 0 || isPristine())) { take(cloud); return; }
      await push();
    }

    function sync() {
      if (running) { rerun = true; return running; }
      running = (async () => {
        try {
          do {
            rerun = false;
            await run();
          } while (rerun);
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
      rev++;
      meta.editedAt = now();
      meta.dirty = true;
      saveMeta();
      if (status === 'saved' || status === 'idle') set('pending');
      schedule();
    }

    async function listHistory() {
      const res = await call('GET', historyEndpoint);
      if (res.net || res.status !== 200) throw new Error(res.net ? 'offline' : res.json.error || String(res.status));
      return res.json.items;
    }

    // กู้คืนชุดในประวัติ: ใช้ในเครื่องนี้ทันที แล้วบันทึกเป็นชุดล่าสุด (เซิร์ฟเวอร์สำรองชุดปัจจุบันไว้ก่อน)
    async function restore(id) {
      const res = await call('GET', `${historyEndpoint}?id=${encodeURIComponent(id)}`);
      if (res.net || res.status !== 200) throw new Error(res.net ? 'offline' : res.json.error || String(res.status));
      applyData(res.json.data);
      restoring = true;
      markDirty();
      clearTimer(timer);
      timer = null;
      await sync();
    }

    function start() {
      return sync();
    }

    function getStatus() {
      return { status, detail, updatedAt: meta.updatedAt, editedAt: meta.editedAt, dirty: meta.dirty };
    }

    return { markDirty, sync, start, getStatus, listHistory, restore };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cloud = api;
})(typeof window !== 'undefined' ? window : globalThis);
