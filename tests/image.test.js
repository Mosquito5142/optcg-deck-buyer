const test = require('node:test');
const assert = require('node:assert/strict');
const { handleImage } = require('../api/_image.js');

function fakeFetch(respond) {
  const calls = [];
  const fn = async (url) => { calls.push(url); return respond(url); };
  fn.calls = calls;
  return fn;
}
const response = (status, type, bytes = []) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) },
  arrayBuffer: async () => Uint8Array.from(bytes).buffer,
});

test('ดึงรูปจาก optcgapi ตามรหัส ส่งต่อพร้อมชนิดไฟล์และ cache ยาว', async () => {
  const f = fakeFetch(() => response(200, 'image/jpeg', [1, 2, 3]));
  const out = await handleImage({ query: { code: 'op12-071' } }, { fetchImpl: f });
  assert.equal(f.calls[0], 'https://optcgapi.com/media/static/Card_Images/OP12-071.jpg');
  assert.equal(out.status, 200);
  assert.equal(out.headers['Content-Type'], 'image/jpeg');
  assert.match(out.headers['Cache-Control'], /s-maxage=\d+/);
  assert.deepEqual([...out.body], [1, 2, 3]);
});

test('รหัสแปลก ๆ หรือพยายามใส่ URL อื่น → 400 และไม่ดึงอะไรเลย', async () => {
  const f = fakeFetch(() => response(200, 'image/jpeg', [1]));
  for (const code of ['', '../etc/passwd', 'https://evil.example/x', 'OP01-016/../../x', 'OP01-016.jpg?', 'A'.repeat(20)]) {
    const out = await handleImage({ query: { code } }, { fetchImpl: f });
    assert.equal(out.status, 400, code);
  }
  assert.equal((await handleImage({}, { fetchImpl: f })).status, 400);
  assert.equal(f.calls.length, 0);
});

test('optcgapi ไม่มีรูป (404 หรือได้หน้า HTML) → 404 แบบ cache สั้น', async () => {
  const notFound = await handleImage({ query: { code: 'OP18-064' } }, { fetchImpl: fakeFetch(() => response(404, 'text/html')) });
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body, null);
  const html = await handleImage({ query: { code: 'OP18-064' } }, { fetchImpl: fakeFetch(() => response(200, 'text/html', [60])) });
  assert.equal(html.status, 404);
});

test('ต่อ optcgapi ไม่ได้ → 502', async () => {
  const out = await handleImage({ query: { code: 'OP01-016' } }, { fetchImpl: async () => { throw new TypeError('down'); } });
  assert.equal(out.status, 502);
});
