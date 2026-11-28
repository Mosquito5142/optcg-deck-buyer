// คนขายเคยอยู่ลิสต์เดียวทั้งแอป (state.sellers) หน้าจอจึงวาดกล่องชุดเดียวกันทุกเด็ค
// เพิ่มคนขายในเด็คหนึ่ง เด็คอื่นจึงเห็นกล่องว่างชื่อเดียวกันด้วย
// ไฟล์นี้ย้ายให้แต่ละเด็คมี sellers ของตัวเอง และยังอ่านไฟล์เก่า (Export / ประวัติ) ได้
(function (root) {
  'use strict';

  // มีหลักฐานว่ากล่องนี้เป็นของเด็คนี้จริง ไม่นับค่าส่ง เพราะค่าส่งอยู่บนคนขายคนเดียวกันทั้งแอป
  // ราคารวม 0 ก็ถือว่ากรอกแล้ว (ช่องว่างคือไม่มีคีย์ ไม่ใช่ 0)
  function hasEvidence(deck, sellerId) {
    if (!deck || sellerId === undefined || sellerId === null) return false;
    const hasCards = Array.isArray(deck.purchases) && deck.purchases.some((p) => p && p.sellerId === sellerId);
    const totals = deck.sellerTotals || {};
    const hasPrice = typeof totals[sellerId] === 'number' && Number.isFinite(totals[sellerId]);
    const hasOffer = !!(deck.offers && deck.offers[sellerId]);
    return hasCards || hasPrice || hasOffer;
  }

  function copySeller(seller) {
    return { ...seller };
  }

  // คืน { state, changed } ไม่แก้ object เดิม
  // changed = true เมื่อต้องย้ายลิสต์ หรือทิ้งลิสต์กลางที่เหลืออยู่
  function migrate(input) {
    if (!input || typeof input !== 'object' || !Array.isArray(input.decks)) {
      return { state: input, changed: false };
    }

    const global = Array.isArray(input.sellers) ? input.sellers.filter((s) => s && typeof s === 'object') : [];
    const perDeck = input.decks.every((d) => d && Array.isArray(d.sellers));

    // ย้ายแล้ว: ไม่กระจายคนขายของเด็คหนึ่งกลับเข้าเด็คอื่น
    // คนขายที่โผล่ในลิสต์กลางแต่ยังไม่มีในเด็คไหนเลย (แท็บเก่าเพิ่มเข้ามา) เก็บไว้ทุกเด็คกันชื่อหาย
    if (perDeck) {
      const known = new Set();
      for (const deck of input.decks) {
        for (const seller of deck.sellers) {
          if (seller && seller.id !== undefined && seller.id !== null) known.add(seller.id);
        }
      }
      const orphans = global.filter((s) => s.id === undefined || s.id === null || !known.has(s.id));
      const hasGlobalKey = Object.prototype.hasOwnProperty.call(input, 'sellers');
      if (orphans.length === 0 && !hasGlobalKey) return { state: input, changed: false };
      const decks = orphans.length === 0
        ? input.decks
        : input.decks.map((deck) => ({ ...deck, sellers: [...deck.sellers, ...orphans.map(copySeller)] }));
      const rest = { ...input };
      delete rest.sellers;
      return { state: { ...rest, decks }, changed: true };
    }

    const homed = new Set();
    for (const deck of input.decks) {
      if (!deck || typeof deck !== 'object') continue;
      for (const seller of global) {
        if (seller.id !== undefined && seller.id !== null && hasEvidence(deck, seller.id)) homed.add(seller.id);
      }
      if (Array.isArray(deck.sellers)) {
        for (const seller of deck.sellers) {
          if (seller && seller.id !== undefined && seller.id !== null) homed.add(seller.id);
        }
      }
    }

    const decks = input.decks.map((deck) => {
      if (!deck || typeof deck !== 'object') return deck;
      // เด็คที่ย้ายไปแล้วคงลิสต์เดิมไว้ ไม่เอากล่องว่างของเด็คอื่นมาแปะ
      if (Array.isArray(deck.sellers)) return deck;
      const sellers = global
        .filter((s) => {
          const id = s.id;
          if (id === undefined || id === null) return true; // ไม่มี id ผูกไม่ได้ เก็บไว้ก่อน
          return hasEvidence(deck, id) || !homed.has(id);
        })
        .map(copySeller);
      return { ...deck, sellers };
    });

    const rest = { ...input };
    delete rest.sellers;
    return { state: { ...rest, decks }, changed: true };
  }

  // รูปแบบใหม่: แต่ละเด็คมี sellers / รูปแบบเก่า: มี sellers ที่ราก และเด็คมี items กับ purchases
  function isValid(s) {
    if (!s || !Array.isArray(s.decks) || s.decks.length === 0) return false;
    const globalOk = Array.isArray(s.sellers);
    return s.decks.every((d) => d && Array.isArray(d.items) && Array.isArray(d.purchases)
      && (Array.isArray(d.sellers) || globalOk));
  }

  const api = { migrate, isValid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sellers = api;
})(typeof window !== 'undefined' ? window : globalThis);
