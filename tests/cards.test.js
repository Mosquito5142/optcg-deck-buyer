const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDeckList, parseOplayHtml, parseDeckInput } = require('../cards.js');

// โครงเดียวกับหน้า deck-builder ของ oplaytcg.com (ตัดคลาสออก)
const pile = (label, src) => `<div data-deck-pile="" data-sel="off" tabindex="0" role="group" aria-label="${label}" class="x">
  <div class="y"><img sizes="120px" alt="a" srcset="${src.replace('/small/', '/thumb/')} 180w, ${src} 365w" src="${src}">
  <span class="z">×9</span><button title="Artworks for this card" aria-label="Artworks for this card"></button></div></div>`;
const OPLAY_HTML = `<div class="grid"><div><div class="h-4">Leader</div><div class="relative group/lead" data-deck-pile="">
  ${pile('Buggy', 'https://cards.oplaytcg.com/OP09/en/small/OP09-042.webp?v=1786238495')}
  <button type="button" title="Remove leader" aria-label="Remove leader"></button></div></div>
  ${pile('Mr.3(Galdino) ×4', 'https://cards.oplaytcg.com/OP09/en/small/OP09-056.webp?v=1')}
  ${pile('Mohji &amp; Cabaji ×3', 'https://cards.oplaytcg.com/OP16/en/small/OP16-051.webp?v=1')}
  ${pile('Buggy ×2', 'https://cards.oplaytcg.com/ST25/en/small/P-084.webp?v=1')}
  <button title="Share" class="w-full"><span>Share</span></button></div>`;

test('อ่าน HTML เด็คจาก oplaytcg: ลีดเดอร์ไม่มี × = 1, ใช้รหัสจากชื่อไฟล์รูป', () => {
  assert.deepEqual(parseOplayHtml(OPLAY_HTML), [
    { code: 'OP09-042', qty: 1 },
    { code: 'OP09-056', qty: 4 },
    { code: 'OP16-051', qty: 3 },
    { code: 'P-084', qty: 2 },
  ]);
});

test('parseDeckInput แยก HTML กับข้อความ deck list เอง', () => {
  assert.equal(parseDeckInput(OPLAY_HTML).items.length, 4);
  assert.deepEqual(parseDeckInput('4xOP01-016').items, [{ code: 'OP01-016', qty: 4 }]);
});

test('อ่าน deck list รูปแบบ NxCODE ต่อบรรทัด', () => {
  const { items, skipped } = parseDeckList('1xOP09-042\n4xOP09-056\n2xP-084\n');
  assert.deepEqual(items, [
    { code: 'OP09-042', qty: 1 },
    { code: 'OP09-056', qty: 4 },
    { code: 'P-084', qty: 2 },
  ]);
  assert.deepEqual(skipped, []);
});

test('ยอมรับช่องว่าง CRLF และตัวพิมพ์เล็ก', () => {
  const { items } = parseDeckList('  4 x st25-002  \r\n\r\n3X eb05-028\r\n');
  assert.deepEqual(items, [
    { code: 'ST25-002', qty: 4 },
    { code: 'EB05-028', qty: 3 },
  ]);
});

test('บรรทัดที่อ่านไม่ได้ถูกข้ามและส่งกลับ', () => {
  const { items, skipped } = parseDeckList('Leader: OP09-042\n0xOP01-001\n4xOP01-016');
  assert.deepEqual(items, [{ code: 'OP01-016', qty: 4 }]);
  assert.deepEqual(skipped, ['Leader: OP09-042', '0xOP01-001']);
});

test('ข้อความว่างได้รายการว่าง', () => {
  assert.deepEqual(parseDeckList(''), { items: [], skipped: [] });
});
