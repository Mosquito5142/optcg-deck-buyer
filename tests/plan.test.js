const test = require('node:test');
const assert = require('node:assert/strict');
const { planBuy, EXACT_LIMIT } = require('../plan.js');

let nextId = 1;
const line = (code, qty, price, pricing = 'each') => ({ id: `l${nextId++}`, code, qty, price, pricing });
const each = (id, shipping, lines) => ({ id, shipping, lines });
const set = (id, shipping, total, lines) => ({ id, shipping, total, lines });

// สรุปแผนเป็น { sellerId: { code: qty } } ให้อ่านง่าย
function picks(plan) {
  const out = {};
  for (const s of plan.sellers) {
    out[s.id] = {};
    for (const l of s.lines) out[s.id][l.code] = (out[s.id][l.code] || 0) + l.qty;
  }
  return out;
}

test('ตัวอย่างของผู้ใช้: ต้องการ 001 ×4, A ใบละ 80, B ใบละ 50 (ไม่มีค่าส่ง) → ซื้อกับ B', () => {
  const plan = planBuy({
    needs: [{ code: '001', left: 4 }],
    sellers: [each('A', 0, [line('001', 4, 80)]), each('B', 0, [line('001', 4, 50)])],
  });
  assert.deepEqual(picks(plan), { B: { '001': 4 } });
  assert.equal(plan.total, 200);
  assert.deepEqual(plan.missing, []);
  assert.equal(plan.exact, true);
});

test('ค่าส่งทำให้คำตอบเปลี่ยน: B ถูกกว่าต่อใบแต่ค่าส่งแพง → ซื้อกับ A', () => {
  const plan = planBuy({
    needs: [{ code: '001', left: 4 }],
    sellers: [each('A', 0, [line('001', 4, 80)]), each('B', 150, [line('001', 4, 50)])],
  });
  // A = 320, B = 200 + 150 = 350
  assert.deepEqual(picks(plan), { A: { '001': 4 } });
  assert.equal(plan.total, 320);
});

test('รวมออเดอร์คนเดียวเพื่อประหยัดค่าส่ง', () => {
  const plan = planBuy({
    needs: [{ code: 'X', left: 1 }, { code: 'Y', left: 1 }],
    sellers: [
      each('A', 40, [line('X', 1, 100), line('Y', 1, 100)]),
      each('B', 50, [line('X', 1, 90)]),
    ],
  });
  // A อย่างเดียว 240 · แยก 90+50 + 100+40 = 280
  assert.deepEqual(picks(plan), { A: { X: 1, Y: 1 } });
  assert.equal(plan.total, 240);
});

test('คนขายมีของไม่พอ → แบ่งซื้อหลายคน', () => {
  const plan = planBuy({
    needs: [{ code: '001', left: 4 }],
    sellers: [each('A', 0, [line('001', 4, 80)]), each('B', 0, [line('001', 2, 50)])],
  });
  assert.deepEqual(picks(plan), { A: { '001': 2 }, B: { '001': 2 } });
  assert.equal(plan.total, 260);
});

test('เซ็ตทั้งกล่องถูกกว่าซื้อแยก → เลือกเซ็ต และบอกใบที่ได้เกินเป็นของแถม', () => {
  const plan = planBuy({
    needs: [{ code: 'X', left: 2 }, { code: 'Y', left: 1 }],
    sellers: [
      set('C', 0, 150, [line('X', 2, 0), line('Y', 1, 0), line('W', 1, 0)]),
      each('A', 0, [line('X', 2, 60), line('Y', 1, 60)]),
    ],
  });
  assert.deepEqual(picks(plan), { C: { X: 2, Y: 1, W: 1 } });
  assert.equal(plan.total, 150);
  assert.equal(plan.sellers[0].isSet, true);
  assert.deepEqual(plan.extra, [{ code: 'W', qty: 1 }]);
});

test('เซ็ตแพงกว่า → ไม่เลือก ซื้อแยกแทน', () => {
  const plan = planBuy({
    needs: [{ code: 'X', left: 1 }],
    sellers: [
      set('C', 0, 300, [line('X', 1, 0), line('W', 3, 0)]),
      each('A', 0, [line('X', 1, 60)]),
    ],
  });
  assert.deepEqual(picks(plan), { A: { X: 1 } });
});

test('เซ็ตช่วยครึ่งหนึ่ง ที่เหลือเติมจากราคาต่อใบ', () => {
  const plan = planBuy({
    needs: [{ code: 'X', left: 4 }],
    sellers: [
      set('C', 0, 100, [line('X', 2, 0)]),
      each('A', 0, [line('X', 4, 80)]),
    ],
  });
  // C(2) + A(2) = 100 + 160 = 260 · A อย่างเดียว 320
  assert.deepEqual(picks(plan), { C: { X: 2 }, A: { X: 2 } });
  assert.equal(plan.total, 260);
});

test('รายการราคาเหมาในกล่องแยกใบ → ต้องซื้อทั้งรายการ', () => {
  const plan = planBuy({
    needs: [{ code: 'X', left: 1 }],
    sellers: [
      each('A', 0, [line('X', 4, 120, 'lot')]), // 4 ใบเหมา 120 (ต้องเอาทั้ง 4)
      each('B', 0, [line('X', 4, 100)]),
    ],
  });
  assert.deepEqual(picks(plan), { B: { X: 1 } });
  const plan2 = planBuy({
    needs: [{ code: 'X', left: 4 }],
    sellers: [each('A', 0, [line('X', 4, 120, 'lot')]), each('B', 0, [line('X', 4, 100)])],
  });
  assert.deepEqual(picks(plan2), { A: { X: 4 } });
  assert.equal(plan2.sellers[0].lines[0].whole, true);
});

test('ไม่มีใครขายบางใบ → ได้ครบที่สุดเท่าที่ทำได้ และบอกใบที่ขาด', () => {
  const plan = planBuy({
    needs: [{ code: 'X', left: 2 }, { code: 'Z', left: 1 }],
    sellers: [each('A', 0, [line('X', 1, 999)])],
  });
  assert.deepEqual(picks(plan), { A: { X: 1 } });
  assert.deepEqual(plan.missing, [{ code: 'X', qty: 1 }, { code: 'Z', qty: 1 }]);
});

test('ไม่มีอะไรต้องซื้อ → แผนว่าง ไม่เลือกเซ็ตที่ไม่จำเป็น', () => {
  const plan = planBuy({
    needs: [{ code: 'X', left: 0 }],
    sellers: [set('C', 0, 100, [line('X', 2, 0)]), each('A', 0, [line('X', 4, 10)])],
  });
  assert.deepEqual(plan.sellers, []);
  assert.equal(plan.total, 0);
});

test(`ข้อเสนอเกิน ${EXACT_LIMIT} หน่วย → ใช้วิธีประมาณ และยังได้คำตอบที่สมเหตุสมผล`, () => {
  const sellers = Array.from({ length: 24 }, (_, i) => each(`S${i}`, 30, [line('X', 2, 100 + i), line('Y', 2, 100 + i)]));
  const plan = planBuy({ needs: [{ code: 'X', left: 2 }, { code: 'Y', left: 2 }], sellers });
  assert.equal(plan.exact, false);
  assert.deepEqual(plan.missing, []);
  assert.equal(plan.total, 400 + 30);
});

// brute force: ลองทุกการรับห่อ และทุกการแบ่งจำนวนราคาต่อใบ (กรณีเล็ก) แล้วเทียบผล
function bruteForce(needs, sellers) {
  const need = Object.fromEntries(needs.map((n) => [n.code, n.left]));
  const pkgs = [];
  const singles = [];
  sellers.forEach((s, si) => {
    if (typeof s.total === 'number') { pkgs.push({ si, cost: s.total, lines: s.lines }); return; }
    for (const l of s.lines) {
      if (l.pricing === 'lot') pkgs.push({ si, cost: l.price, lines: [l] });
      else singles.push({ si, l });
    }
  });
  let best = null;
  const qty = new Array(singles.length).fill(0);
  function score(pmask) {
    const got = {};
    const used = new Set();
    let cost = 0;
    pkgs.forEach((p, i) => {
      if (!((pmask >> i) & 1)) return;
      cost += p.cost; used.add(p.si);
      for (const l of p.lines) got[l.code] = (got[l.code] || 0) + l.qty;
    });
    singles.forEach((o, i) => {
      if (!qty[i]) return;
      cost += qty[i] * o.l.price; used.add(o.si);
      got[o.l.code] = (got[o.l.code] || 0) + qty[i];
    });
    for (const si of used) cost += sellers[si].shipping;
    const covered = Object.keys(need).reduce((a, c) => a + Math.min(need[c], got[c] || 0), 0);
    if (!best || covered > best.covered || (covered === best.covered && cost < best.cost - 1e-9)) best = { covered, cost };
  }
  function rec(i, pmask) {
    if (i === singles.length) { score(pmask); return; }
    for (let q = 0; q <= singles[i].l.qty; q++) { qty[i] = q; rec(i + 1, pmask); }
    qty[i] = 0;
  }
  for (let pmask = 0; pmask < 2 ** pkgs.length; pmask++) rec(0, pmask);
  return best;
}

test('ผลตรงกับ brute force ในกรณีสุ่ม 300 แบบ (มีทั้งเซ็ต เหมา และราคาต่อใบ)', () => {
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const codes = ['A', 'B', 'C'];
  for (let t = 0; t < 300; t++) {
    const sellers = [];
    const n = 2 + rnd(3);
    for (let s = 0; s < n; s++) {
      const lines = codes.filter(() => rnd(2)).map((c) => line(c, 1 + rnd(2), 10 + rnd(50), rnd(5) === 0 ? 'lot' : 'each'));
      if (!lines.length) lines.push(line(codes[rnd(3)], 1 + rnd(2), 10 + rnd(50)));
      sellers.push(rnd(4) === 0 ? set(`S${s}`, rnd(4) * 20, 30 + rnd(100), lines) : each(`S${s}`, rnd(4) * 20, lines));
    }
    const needs = codes.map((code) => ({ code, left: rnd(3) }));
    const plan = planBuy({ needs, sellers });
    const brute = bruteForce(needs, sellers);
    const covered = needs.reduce((a, n) => a + n.left, 0) - plan.missing.reduce((a, m) => a + m.qty, 0);
    assert.equal(covered, brute.covered, `case ${t} covered`);
    assert.ok(Math.abs(plan.total - brute.cost) < 1e-9, `case ${t}: plan ${plan.total} vs brute ${brute.cost}`);
  }
});
