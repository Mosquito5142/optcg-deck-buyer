// หาแผนซื้อที่ถูกที่สุดจากข้อเสนอของคนขายหลายคน (รวมค่าส่ง) — ฟังก์ชันบริสุทธิ์ ไม่แตะ DOM
// ข้อเสนอมีสองแบบ:
//  - ห่อ (ต้องซื้อทั้งห่อ): กล่องที่ตั้งราคารวม (เซ็ต) และรายการราคาเหมาในกล่องแยกใบ
//  - ราคาต่อใบ: เลือกซื้อได้ไม่เกินจำนวนที่คนขายมี
// ลองทุกชุดของ "หน่วย" (ห่อแต่ละห่อ + คนขายที่มีราคาต่อใบ) เมื่อรู้ชุดแล้ว ใช้การ์ดจากห่อก่อน
// แล้วเติมจากราคาต่อใบที่ถูกสุดก่อน (เมื่อกำหนดชุดคนขายแล้ว วิธีนี้ถูกที่สุดเสมอ) ค่าส่งคิดเฉพาะคนที่ได้ซื้อจริง
(function (root) {
  'use strict';

  const EXACT_LIMIT = 20; // ลองครบทุกชุดได้ถึง 2^20 ชุด
  const EPS = 1e-9;

  function num(x) {
    const n = Number(x);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  // needs: [{ code, left }]
  // sellers: [{ id, shipping, total? (ตัวเลข = เซ็ตทั้งกล่อง), lines: [{ id, code, qty, price, pricing }] }]
  function planBuy({ needs, sellers }) {
    const need = new Map();
    for (const n of needs) {
      const q = Math.floor(num(n.left));
      if (q > 0) need.set(n.code, (need.get(n.code) || 0) + q);
    }
    const codes = [...need.keys()];

    const packages = []; // { seller, cost, lines: [line] }
    const singles = new Map(); // code -> [{ seller, line, price, qty }]
    sellers.forEach((s, seller) => {
      const lines = (s.lines || []).filter((l) => Math.floor(num(l.qty)) > 0);
      if (typeof s.total === 'number') {
        if (lines.length) packages.push({ seller, cost: num(s.total), lines });
        return;
      }
      for (const l of lines) {
        if (l.pricing === 'lot') packages.push({ seller, cost: num(l.price), lines: [l] });
        else if (need.has(l.code)) {
          if (!singles.has(l.code)) singles.set(l.code, []);
          singles.get(l.code).push({ seller, line: l, price: num(l.price), qty: Math.floor(num(l.qty)) });
        }
      }
    });
    for (const list of singles.values()) list.sort((a, b) => a.price - b.price || a.seller - b.seller);

    // ห่อที่ไม่มีการ์ดที่ต้องการเลยไม่มีทางช่วย ตัดทิ้งเพื่อให้ค้นเร็วขึ้น
    const usefulPackages = packages.filter((p) => p.lines.some((l) => need.has(l.code)));
    const singleSellers = [...new Set([...singles.values()].flat().map((o) => o.seller))];
    const units = [
      ...usefulPackages.map((p) => ({ type: 'package', pkg: p })),
      ...singleSellers.map((seller) => ({ type: 'seller', seller })),
    ];

    // เตรียมข้อมูลเป็นตัวเลขล้วน: ค้นได้เป็นล้านชุดโดยไม่สร้างออบเจกต์ใหม่ทุกรอบ
    const codeIndex = new Map(codes.map((c, i) => [c, i]));
    const needArr = codes.map((c) => need.get(c));
    const pkgGot = units.map((u) => {
      const g = new Array(codes.length).fill(0);
      if (u.type === 'package') for (const l of u.pkg.lines) if (codeIndex.has(l.code)) g[codeIndex.get(l.code)] += Math.floor(num(l.qty));
      return g;
    });
    const singleUnit = new Map(units.map((u, i) => [u.type === 'seller' ? u.seller : -1, i]));
    const offersByCode = codes.map((c) => (singles.get(c) || []).map((o) => ({ ...o, unit: singleUnit.get(o.seller) })));
    const shipping = sellers.map((s) => num(s.shipping));
    const got = new Array(codes.length);
    const usedMark = new Array(sellers.length).fill(-1);

    // details=true เก็บรายการที่เลือก (ใช้กับแบบที่ดีที่สุดแบบเดียวตอนจบ)
    function evaluate(chosen, details = false) {
      let cost = 0;
      let used = 0;
      let packages = 0;
      const stamp = ++evaluate.round;
      const takenPackages = details ? [] : null;
      const takes = details ? [] : null;
      got.fill(0);
      for (let i = 0; i < units.length; i++) {
        if (!chosen[i] || units[i].type !== 'package') continue;
        const p = units[i].pkg;
        packages++;
        cost += p.cost;
        if (usedMark[p.seller] !== stamp) { usedMark[p.seller] = stamp; used++; cost += shipping[p.seller]; }
        const g = pkgGot[i];
        for (let c = 0; c < g.length; c++) got[c] += g[c];
        if (details) takenPackages.push(p);
      }
      let covered = 0;
      for (let c = 0; c < codes.length; c++) {
        let left = needArr[c] - got[c];
        covered += Math.min(needArr[c], got[c]);
        if (left <= 0) continue;
        const offers = offersByCode[c];
        for (let k = 0; k < offers.length && left > 0; k++) {
          const o = offers[k];
          if (!chosen[o.unit]) continue;
          const q = left < o.qty ? left : o.qty;
          left -= q;
          covered += q;
          cost += q * o.price;
          if (usedMark[o.seller] !== stamp) { usedMark[o.seller] = stamp; used++; cost += shipping[o.seller]; }
          if (details) takes.push({ o, qty: q });
        }
      }
      return { covered, cost, sellersUsed: used, packages, takenPackages, takes };
    }
    evaluate.round = 0;

    function better(a, b) {
      if (!b) return true;
      if (a.covered !== b.covered) return a.covered > b.covered;
      if (Math.abs(a.cost - b.cost) > EPS) return a.cost < b.cost;
      if (a.sellersUsed !== b.sellersUsed) return a.sellersUsed < b.sellersUsed;
      return a.packages < b.packages;
    }

    const exact = units.length <= EXACT_LIMIT;
    let best = null;
    let bestChosen = new Array(units.length).fill(false);
    const chosen = new Array(units.length).fill(false);
    if (exact) {
      for (let mask = 0; mask < 2 ** units.length; mask++) {
        for (let i = 0; i < units.length; i++) chosen[i] = (mask >>> i) % 2 === 1;
        const r = evaluate(chosen);
        if (better(r, best)) { best = r; bestChosen = chosen.slice(); }
      }
    } else {
      // ข้อเสนอเยอะเกิน: เริ่มจากเปิดทุกหน่วย แล้วลองสลับทีละหน่วยจนไม่ดีขึ้น
      chosen.fill(true);
      best = evaluate(chosen);
      let improved = true;
      while (improved) {
        improved = false;
        for (let i = 0; i < units.length; i++) {
          chosen[i] = !chosen[i];
          const r = evaluate(chosen);
          if (better(r, best)) { best = r; improved = true; } else chosen[i] = !chosen[i];
        }
      }
      bestChosen = chosen.slice();
    }

    return toPlan(evaluate(bestChosen, true), sellers, need, exact);
  }

  function toPlan(best, sellers, need, exact) {
    const bySeller = new Map();
    const box = (seller) => {
      if (!bySeller.has(seller)) {
        const s = sellers[seller];
        bySeller.set(seller, { id: s.id, isSet: typeof s.total === 'number', cardCost: 0, shipping: num(s.shipping), lines: [] });
      }
      return bySeller.get(seller);
    };
    const got = new Map();
    for (const p of best.takenPackages) {
      const b = box(p.seller);
      b.cardCost += p.cost;
      for (const l of p.lines) {
        const qty = Math.floor(num(l.qty));
        b.lines.push({ lineId: l.id, code: l.code, qty, price: num(l.price), whole: true });
        got.set(l.code, (got.get(l.code) || 0) + qty);
      }
    }
    for (const { o, qty } of best.takes) {
      const b = box(o.seller);
      b.cardCost += qty * o.price;
      b.lines.push({ lineId: o.line.id, code: o.line.code, qty, price: o.price, whole: false });
      got.set(o.line.code, (got.get(o.line.code) || 0) + qty);
    }
    const plan = [...bySeller.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => ({ ...b, total: b.cardCost + b.shipping }));
    const missing = [...need.entries()].filter(([code, q]) => (got.get(code) || 0) < q).map(([code, q]) => ({ code, qty: q - (got.get(code) || 0) }));
    // การ์ดที่ได้จากห่อเกินจำนวนที่ต้องการ (รวมใบที่เด็คไม่ใช้) = ของแถม
    const extra = [...got.entries()].filter(([code, q]) => q > (need.get(code) || 0)).map(([code, q]) => ({ code, qty: q - (need.get(code) || 0) }));
    return {
      exact,
      sellers: plan,
      cardCost: plan.reduce((a, b) => a + b.cardCost, 0),
      shippingCost: plan.reduce((a, b) => a + b.shipping, 0),
      total: plan.reduce((a, b) => a + b.total, 0),
      missing,
      extra,
    };
  }

  const api = { planBuy, EXACT_LIMIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Plan = api;
})(typeof window !== 'undefined' ? window : globalThis);
