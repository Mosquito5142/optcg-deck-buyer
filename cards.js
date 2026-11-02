// ดึงชื่อ/rarity/รูปการ์ดจาก optcgapi.com (เปิด CORS เรียกจากเบราว์เซอร์ได้)
(function (root) {
  'use strict';

  const API = 'https://optcgapi.com/api';

  function normalizeCode(raw) {
    return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  function endpointFor(code) {
    if (/^ST\d/.test(code)) return `${API}/decks/card/${code}/`;
    if (/^P-\d/.test(code)) return `${API}/promos/card/${code}/`;
    return `${API}/sets/card/${code}/`;
  }

  // รูปจากเกม OPTCGSim ในเครื่อง (ไม่มีลายน้ำ และมีการ์ดที่ optcgapi ไม่มีรูป)
  // แอปอยู่ที่ Downloads/optcg-deck-buyer ส่วนเกมอยู่ที่ Downloads/Builds_Windows
  const GAME_CARDS = '../Builds_Windows/OPTCGSim_Data/StreamingAssets/Cards';

  function gameImage(code) {
    const set = code.split('-')[0];
    return `${GAME_CARDS}/${encodeURIComponent(set)}/${encodeURIComponent(code)}.jpg`;
  }

  // คืน { name, rarity, image } หรือ null ถ้าไม่พบ; โยน error ถ้าเชื่อมต่อไม่ได้
  async function lookupCard(code) {
    const res = await fetch(endpointFor(code));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`optcgapi ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) return null;
    const base = list.find((c) => c.card_image_id === code) || list[0];
    return { name: base.card_name || code, rarity: base.rarity || '', image: base.card_image || '' };
  }

  // แปลงไฟล์ deck list รูปแบบ "4xOP01-016" ต่อบรรทัด เป็น [{ code, qty }]; บรรทัดที่อ่านไม่ได้ส่งกลับใน skipped
  function parseDeckList(text) {
    const items = [];
    const skipped = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(\d+)\s*x\s*([A-Za-z0-9-]+)$/i);
      if (!m || Number(m[1]) < 1) { skipped.push(line); continue; }
      items.push({ code: normalizeCode(m[2]), qty: Number(m[1]) });
    }
    return { items, skipped };
  }

  // แปลง HTML หน้าเด็คของ oplaytcg.com (คัดลอกจาก Inspect) เป็น [{ code, qty }]
  // แต่ละการ์ดคือ role="group" ที่มี aria-label "ชื่อ ×N" (ลีดเดอร์ไม่มี ×N = 1 ใบ)
  // และรูป .../<รหัส>.webp — ใช้ชื่อไฟล์รูป เพราะโฟลเดอร์ชุดอาจไม่ตรงกับรหัส (เช่น ST25/.../P-084.webp)
  function parseOplayHtml(html) {
    const items = [];
    const chunks = String(html || '').split(/role="group"/).slice(1);
    for (const chunk of chunks) {
      const label = chunk.match(/aria-label="([^"]*)"/);
      const img = chunk.match(/\/([A-Za-z0-9]+-[A-Za-z0-9]+)\.(?:webp|png|jpe?g)/);
      if (!label || !img) continue;
      const q = label[1].match(/×\s*(\d+)\s*$/);
      const code = normalizeCode(img[1]);
      const qty = q ? Number(q[1]) : 1;
      const existing = items.find((i) => i.code === code);
      if (existing) existing.qty += qty;
      else items.push({ code, qty });
    }
    return items;
  }

  // รับได้ทั้งข้อความ deck list และ HTML จาก oplaytcg
  function parseDeckInput(text) {
    if (/role="group"/.test(text)) return { items: parseOplayHtml(text), skipped: [] };
    return parseDeckList(text);
  }

  const api = { normalizeCode, lookupCard, parseDeckList, parseOplayHtml, parseDeckInput, gameImage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cards = api;
})(typeof window !== 'undefined' ? window : globalThis);
