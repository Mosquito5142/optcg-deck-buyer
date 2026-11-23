// คำนวณยอดของเด็ค: การ์ดที่เหลือ/เกิน และยอดของแต่ละกล่องคนขาย (ฟังก์ชันบริสุทธิ์ ไม่แตะ DOM)
(function (root) {
  'use strict';

  // ยอดของหนึ่งรายการจัดซื้อ: ราคาต่อใบ = qty × price; ราคาเหมา = price ทั้งรายการ
  function lineTotal(p) {
    return p.pricing === 'lot' ? p.price : p.qty * p.price;
  }

  // sellers: [{ id, name, shipping, total? (ราคารวม), offer? (true = ยังเป็นข้อเสนอ ไม่นับในยอด) }]
  function summarizeDeck(deck, sellers) {
    const sellerIds = new Set(sellers.map((s) => s.id));
    const offerIds = new Set(sellers.filter((s) => s.offer).map((s) => s.id));
    const valid = deck.purchases.filter((p) => sellerIds.has(p.sellerId));

    const bought = {};
    const offeredBy = {};
    for (const p of valid) {
      if (offerIds.has(p.sellerId)) (offeredBy[p.code] = offeredBy[p.code] || new Set()).add(p.sellerId);
      else bought[p.code] = (bought[p.code] || 0) + p.qty;
    }

    const remaining = deck.items.map(({ code, qty }) => {
      const b = bought[code] || 0;
      return { code, need: qty, bought: b, left: Math.max(0, qty - b), over: Math.max(0, b - qty), offers: offeredBy[code] ? offeredBy[code].size : 0 };
    });

    const boxes = sellers.map((s) => {
      const lines = valid.filter((p) => p.sellerId === s.id);
      // ถ้าคนขายตั้งราคารวมไว้ ใช้ราคารวมนั้นแทนผลรวมรายการ
      const sum = lines.reduce((a, p) => a + lineTotal(p), 0);
      const cardCost = typeof s.total === 'number' ? s.total : sum;
      const shipping = lines.length > 0 ? Number(s.shipping) || 0 : 0;
      return { id: s.id, name: s.name, offer: !!s.offer, cardCost, shipping, total: cardCost + shipping, lines };
    });

    const confirmed = boxes.filter((b) => !b.offer);
    const cardCost = confirmed.reduce((a, b) => a + b.cardCost, 0);
    const shippingCost = confirmed.reduce((a, b) => a + b.shipping, 0);
    const missingCount = remaining.reduce((a, r) => a + r.left, 0);

    return { remaining, sellers: boxes, cardCost, shippingCost, total: cardCost + shippingCost, missingCount };
  }

  const api = { deckSummary: summarizeDeck, lineTotal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Buy = api;
})(typeof window !== 'undefined' ? window : globalThis);
