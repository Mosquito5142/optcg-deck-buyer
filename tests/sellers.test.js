const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate, isValid } = require('../sellers.js');
const { deckSummary } = require('../buy.js');

// โครงเดียวกับข้อมูลจริง: คนขายอยู่ลิสต์กลาง จึงไปโผล่ทุกเด็ค
// Pob มีการ์ดในพี่คุกกับ enal, Mee / TCG มีการ์ดแค่ enal, Wisutthi มีการ์ดทุกเด็ค
function ownerData() {
  return {
    sellers: [
      { id: 'w', name: 'Wisutthi Wongbuangarm', shipping: 60 },
      { id: 'p', name: 'Pob Chaikuea', shipping: 30 },
      { id: 'm', name: 'Mee Man U', shipping: 50 },
      { id: 't', name: 'TCG Thailand', shipping: 40 },
    ],
    decks: [
      {
        id: 'd1', name: 'พี่คุก',
        items: [{ code: 'A', qty: 2 }],
        purchases: [
          { id: '1', sellerId: 'w', code: 'A', qty: 1, price: 10 },
          { id: '2', sellerId: 'p', code: 'A', qty: 1, price: 20 },
        ],
        sellerTotals: { w: 50, p: 0 },
      },
      {
        id: 'd2', name: 'imu',
        items: [{ code: 'B', qty: 1 }],
        purchases: [{ id: '3', sellerId: 'w', code: 'B', qty: 1, price: 5 }],
        sellerTotals: { w: 100 },
      },
      {
        id: 'd3', name: 'enal',
        items: [{ code: 'C', qty: 4 }],
        purchases: [
          { id: '4', sellerId: 'w', code: 'C', qty: 1, price: 1 },
          { id: '5', sellerId: 'p', code: 'C', qty: 1, price: 2 },
          { id: '6', sellerId: 'm', code: 'C', qty: 1, price: 3 },
          { id: '7', sellerId: 't', code: 'C', qty: 1, price: 4 },
        ],
        sellerTotals: { w: 150 },
        offers: { m: true },
      },
    ],
    currentDeckId: 'd3',
    cards: { A: { name: 'การ์ด' } },
  };
}

const names = (deck) => deck.sellers.map((s) => s.name);

test('ย้ายแล้วแต่ละเด็คเห็นเฉพาะคนขายที่มีการ์ด ราคา หรือข้อเสนอ', () => {
  const { state, changed } = migrate(ownerData());
  assert.equal(changed, true);
  assert.equal(state.sellers, undefined);
  const [cook, imu, enal] = state.decks;
  assert.deepEqual(names(cook), ['Wisutthi Wongbuangarm', 'Pob Chaikuea']);
  assert.deepEqual(names(imu), ['Wisutthi Wongbuangarm']);
  assert.deepEqual(names(enal), ['Wisutthi Wongbuangarm', 'Pob Chaikuea', 'Mee Man U', 'TCG Thailand']);
  // ของเดิมในเด็คไม่หาย
  assert.equal(cook.purchases.length, 2);
  assert.deepEqual(cook.sellerTotals, { w: 50, p: 0 });
  assert.deepEqual(enal.offers, { m: true });
  assert.equal(state.currentDeckId, 'd3');
  assert.equal(state.cards.A.name, 'การ์ด');
});

test('ค่าส่งอย่างเดียวไม่ทำให้กล่องว่างหลุดไปเด็คอื่น', () => {
  const { state } = migrate(ownerData());
  const imu = state.decks.find((d) => d.name === 'imu');
  assert.equal(imu.sellers.some((s) => s.name === 'Mee Man U'), false);
  assert.equal(imu.sellers.some((s) => s.name === 'Pob Chaikuea'), false);
  const mee = state.decks.find((d) => d.name === 'enal').sellers.find((s) => s.id === 'm');
  assert.equal(mee.shipping, 50);
});

test('ราคารวม 0 คือกรอกแล้ว เก็บกล่องไว้แม้ยังไม่มีการ์ด', () => {
  const { state } = migrate({
    sellers: [{ id: 'z', name: 'Zero', shipping: 15 }],
    decks: [
      { id: 'a', name: 'A', items: [], purchases: [], sellerTotals: { z: 0 } },
      { id: 'b', name: 'B', items: [], purchases: [] },
    ],
  });
  assert.deepEqual(names(state.decks[0]), ['Zero']);
  assert.deepEqual(names(state.decks[1]), []);
});

test('มีสถานะข้อเสนอแต่ยังไม่มีการ์ด เก็บไว้ที่เด็คนั้นอย่างเดียว', () => {
  const { state } = migrate({
    sellers: [{ id: 'o', name: 'Offer', shipping: 10 }],
    decks: [
      { id: 'a', name: 'A', items: [], purchases: [], offers: { o: true } },
      { id: 'b', name: 'B', items: [], purchases: [] },
    ],
  });
  assert.deepEqual(names(state.decks[0]), ['Offer']);
  assert.deepEqual(names(state.decks[1]), []);
});

test('คนขายที่ยังไม่ผูกกับเด็คไหนเลย เก็บไว้ทุกเด็คกันชื่อหาย', () => {
  const { state } = migrate({
    sellers: [{ id: 'n', name: 'ยังว่าง', shipping: 20 }],
    decks: [
      { id: 'a', name: 'A', items: [], purchases: [] },
      { id: 'b', name: 'B', items: [], purchases: [] },
    ],
  });
  assert.deepEqual(names(state.decks[0]), ['ยังว่าง']);
  assert.deepEqual(names(state.decks[1]), ['ยังว่าง']);
  state.decks[0].sellers[0].name = 'แก้แล้ว';
  assert.equal(state.decks[1].sellers[0].name, 'ยังว่าง');
});

test('แก้ชื่อหรือค่าส่งในเด็คหนึ่ง ไม่เปลี่ยนสำเนาในเด็คอื่น', () => {
  const { state } = migrate(ownerData());
  const cook = state.decks[0].sellers.find((s) => s.id === 'w');
  const imu = state.decks[1].sellers.find((s) => s.id === 'w');
  cook.name = 'ชื่อใหม่';
  cook.shipping = 1;
  assert.equal(imu.name, 'Wisutthi Wongbuangarm');
  assert.equal(imu.shipping, 60);
});

test('ยอดของเด็คไม่นับคนขายที่หลุดมา และไม่กินยอดเด็คที่เป็นเจ้าของ', () => {
  const before = ownerData();
  const { state } = migrate(before);
  const view = (deck, sellers) => sellers.map((s) => {
    const total = (deck.sellerTotals || {})[s.id];
    return { ...s, ...(typeof total === 'number' ? { total } : {}), offer: !!(deck.offers || {})[s.id] };
  });
  const imu = state.decks[1];
  const enal = state.decks[2];
  const imuSum = deckSummary(imu, view(imu, imu.sellers));
  const enalSum = deckSummary(enal, view(enal, enal.sellers));
  assert.deepEqual(imuSum.sellers.map((s) => s.id), ['w']);
  assert.equal(imuSum.cardCost, 100);
  assert.equal(enalSum.sellers.length, 4);
  // Mee เป็นข้อเสนอ ไม่เข้าต้นทุน; Wisutthi ใช้ราคารวม 150
  assert.equal(enalSum.cardCost, 150 + 2 + 4);
  assert.equal(enalSum.sellers.find((s) => s.id === 'm').offer, true);
});

test('ไม่แก้ object เดิม และย้ายซ้ำแล้วได้ผลเดิม', () => {
  const input = ownerData();
  const snapshot = JSON.parse(JSON.stringify(input));
  const once = migrate(input);
  assert.deepEqual(input, snapshot);
  assert.equal(input.decks[0].sellers, undefined);
  const exported = JSON.parse(JSON.stringify(once.state));
  const twice = migrate(exported);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.state, exported);
  // เพิ่มคนขายหลังย้ายแล้ว อยู่แค่เด็คนั้น
  exported.decks[1].sellers.push({ id: 'new', name: 'คนขาย imu', shipping: 0 });
  const afterAdd = migrate(exported);
  assert.equal(afterAdd.changed, false);
  assert.equal(afterAdd.state.decks[0].sellers.some((s) => s.id === 'new'), false);
  assert.equal(afterAdd.state.decks[1].sellers.some((s) => s.id === 'new'), true);
});

test('ลิสต์กลางที่ใส่กลับมา ไม่ดึงคนขายของ enal ไปเด็คที่ไม่มีหลักฐาน', () => {
  const { state } = migrate(ownerData());
  state.sellers = state.decks[2].sellers.map((s) => ({ ...s }));
  const again = migrate(state);
  assert.equal(again.changed, true);
  assert.equal(again.state.sellers, undefined);
  assert.deepEqual(names(again.state.decks[1]), ['Wisutthi Wongbuangarm']);
});

test('คนขายใหม่ที่ลิสต์กลางยังไม่รู้จักเด็ค เก็บไว้ทุกเด็ค', () => {
  const { state } = migrate(ownerData());
  state.sellers = [{ id: 'brand', name: 'เพิ่งเพิ่ม', shipping: 5 }];
  const again = migrate(state);
  assert.ok(again.state.decks.every((d) => d.sellers.some((s) => s.id === 'brand')));
  again.state.decks[0].sellers.find((s) => s.id === 'brand').shipping = 99;
  assert.equal(again.state.decks[2].sellers.find((s) => s.id === 'brand').shipping, 5);
});

test('isValid รับทั้งรูปแบบเก่าและรูปแบบต่อเด็ค', () => {
  assert.equal(isValid(ownerData()), true);
  assert.equal(isValid(migrate(ownerData()).state), true);
  assert.equal(isValid({ decks: [{ items: [], purchases: [] }] }), false);
  assert.equal(isValid({ sellers: [], decks: [] }), false);
  assert.equal(isValid(null), false);
});
