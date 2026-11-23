// ดึงรูปการ์ดจาก optcgapi ฝั่งเซิร์ฟเวอร์ แล้วส่งให้หน้าเว็บจากโดเมนเดียวกัน
// เหตุผล: optcgapi ไม่ส่ง header CORS เบราว์เซอร์จึงไม่ยอมให้วาดรูปของเขาลงในภาพที่ส่งออก (canvas)
// รับแค่รหัสการ์ด และดึงจาก optcgapi เท่านั้น จึงใช้เป็นตัวดึงหน้าเว็บอื่นไม่ได้
'use strict';

const SOURCE = 'https://optcgapi.com/media/static/Card_Images';
const CODE = /^[A-Z0-9]{1,6}-[A-Z0-9]{1,6}$/;
const MAX_BYTES = 5 * 1024 * 1024;

// req: { query: { code } } → { status, headers, body (Buffer|null) }
async function handleImage(req, { fetchImpl = fetch } = {}) {
  const code = String((req.query && req.query.code) || '').trim().toUpperCase();
  if (!CODE.test(code)) return { status: 400, headers: {}, body: null };
  let res;
  try {
    res = await fetchImpl(`${SOURCE}/${code}.jpg`);
  } catch (_) {
    return { status: 502, headers: {}, body: null };
  }
  const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
  if (!res.ok || !type.startsWith('image/')) {
    // ไม่มีรูป: จำผลไว้ 1 วัน ไม่ต้องถาม optcgapi ซ้ำทุกครั้ง
    return { status: 404, headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' }, body: null };
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_BYTES) return { status: 502, headers: {}, body: null };
  return {
    status: 200,
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800, s-maxage=2592000' },
    body,
  };
}

module.exports = { handleImage };
