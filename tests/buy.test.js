const test = require('node:test');
const assert = require('node:assert/strict');
const { deckSummary } = require('../buy.js');

const sellers = [
  { id: 's1', name: 'A', shipping: 40 },
  { id: 's2', name: 'B', shipping: 0 },
  { id: 's3', name: 'C', shipping: 60 },
];

test('เหลือ/เกิน คำนวณจากจำนวนในเด็คและที่จัดแล้ว', () => {
  const deck = {
    items: [{ code: 'X', qty: 4 }, { code: 'Y', qty: 2 }],
    purchases: [{ id: 'p1', sellerId: 's1', code: 'X', qty: 1, price: 10 }, { id: 'p2', sellerId: 's2', code: 'Y', qty: 3, price: 5 }],
  };
  const r = deckSummary(deck, sellers);
  assert.deepEqual(r.remaining, [
    { code: 'X', need: 4, bought: 1, left: 3, over: 0, offers: 0 },
    { code: 'Y', need: 2, bought: 3, left: 0, over: 1, offers: 0 },
  ]);
  assert.equal(r.missingCount, 3);
});

test('ยอดกล่องรวมค่าการ์ดกับค่าส่ง และไม่คิดค่าส่งถ้ากล่องว่าง', () => {
  const deck = {
    items: [{ code: 'X', qty: 4 }],
    purchases: [{ id: 'p1', sellerId: 's1', code: 'X', qty: 2, price: 100 }],
  };
  const r = deckSummary(deck, sellers);
  const a = r.sellers.find((s) => s.id === 's1');
  const c = r.sellers.find((s) => s.id === 's3');
  assert.deepEqual({ cardCost: a.cardCost, shipping: a.shipping, total: a.total }, { cardCost: 200, shipping: 40, total: 240 });
  assert.deepEqual({ cardCost: c.cardCost, shipping: c.shipping, total: c.total }, { cardCost: 0, shipping: 0, total: 0 });
});

test('ต้นทุนเด็ครวมทุกกล่อง', () => {
  const deck = {
    items: [{ code: 'X', qty: 3 }, { code: 'Y', qty: 1 }],
    purchases: [
      { id: 'p1', sellerId: 's1', code: 'X', qty: 2, price: 100 },
      { id: 'p2', sellerId: 's2', code: 'X', qty: 1, price: 90 },
      { id: 'p3', sellerId: 's2', code: 'Y', qty: 1, price: 50 },
    ],
  };
  const r = deckSummary(deck, sellers);
  // A: 200+40, B: 140+0
  assert.equal(r.cardCost, 340);
  assert.equal(r.shippingCost, 40);
  assert.equal(r.total, 380);
  assert.equal(r.missingCount, 0);
});

test('ราคาเหมาคิดเป็นยอดรวมของรายการ ไม่คูณจำนวน', () => {
  const deck = {
    items: [{ code: 'X', qty: 4 }],
    purchases: [{ id: 'p1', sellerId: 's2', code: 'X', qty: 4, price: 24, pricing: 'lot' }],
  };
  const r = deckSummary(deck, sellers);
  assert.equal(r.cardCost, 24);
  assert.equal(r.total, 24);
  assert.equal(r.missingCount, 0);
});

test('ราคารวมของคนขายแทนผลรวมรายการ และค่าส่งยังคิดเมื่อมีการ์ด', () => {
  const sellersWithTotal = [{ id: 's1', name: 'A', shipping: 40, total: 500 }];
  const deck = {
    items: [{ code: 'X', qty: 3 }],
    purchases: [{ id: 'p1', sellerId: 's1', code: 'X', qty: 3, price: 1 }],
  };
  const r = deckSummary(deck, sellersWithTotal);
  assert.equal(r.cardCost, 500);
  assert.equal(r.total, 540);
  assert.equal(r.missingCount, 0);
});

test('กล่องที่เป็นข้อเสนอไม่นับในยอดและไม่นับเป็นการ์ดที่ได้แล้ว แต่ยังมียอดของกล่องให้ดู', () => {
  const withOffer = [
    { id: 's1', name: 'A', shipping: 40 },
    { id: 's2', name: 'B', shipping: 60, offer: true },
    { id: 's3', name: 'C', shipping: 0, offer: true },
  ];
  const deck = {
    items: [{ code: 'X', qty: 4 }],
    purchases: [
      { id: 'p1', sellerId: 's1', code: 'X', qty: 1, price: 100 },
      { id: 'p2', sellerId: 's2', code: 'X', qty: 4, price: 50 },
      { id: 'p3', sellerId: 's3', code: 'X', qty: 4, price: 80 },
    ],
  };
  const r = deckSummary(deck, withOffer);
  assert.deepEqual(r.remaining, [{ code: 'X', need: 4, bought: 1, left: 3, over: 0, offers: 2 }]);
  assert.equal(r.total, 140);
  const b = r.sellers.find((s) => s.id === 's2');
  assert.deepEqual({ offer: b.offer, total: b.total }, { offer: true, total: 260 });
});

test('ไม่มีการจัดซื้อได้ยอดศูนย์', () => {
  const r = deckSummary({ items: [{ code: 'X', qty: 4 }], purchases: [] }, sellers);
  assert.equal(r.total, 0);
  assert.equal(r.missingCount, 4);
});

test('ข้ามการจัดซื้อที่คนขายไม่มีอยู่แล้ว', () => {
  const deck = {
    items: [{ code: 'X', qty: 1 }],
    purchases: [{ id: 'p1', sellerId: 'gone', code: 'X', qty: 1, price: 100 }],
  };
  const r = deckSummary(deck, sellers);
  assert.equal(r.total, 0);
  assert.equal(r.missingCount, 1);
});
