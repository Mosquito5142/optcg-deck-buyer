// หน้าจอและการบันทึกข้อมูล (localStorage + export/import JSON)
(function () {
  'use strict';

  const STORAGE_KEY = 'optcg-deck-buyer.v2';
  const THEME_KEY = 'optcg-deck-buyer.theme';
  const $ = (sel, el = document) => el.querySelector(sel);
  const narrow = window.matchMedia('(max-width: 859px)');

  // ---------- state ----------

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function newDeck(name) {
    return { id: uid(), name, items: [], purchases: [], sellers: [] };
  }

  function defaultState() {
    const deck = newDeck('เด็คใหม่');
    return { decks: [deck], currentDeckId: deck.id, cards: {} };
  }

  function isValidState(s) {
    return window.Sellers.isValid(s);
  }

  // ข้อมูลเก่าที่คนขายอยู่ลิสต์กลางจะถูกย้ายให้แต่ละเด็คมีของตัวเองตอนโหลด
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (isValidState(s)) {
        const { state: next, changed } = window.Sellers.migrate({ cards: {}, ...s });
        if (!next.decks.some((d) => d.id === next.currentDeckId)) next.currentDeckId = next.decks[0].id;
        return { state: next, changed };
      }
    } catch (_) { /* ข้อมูลเสียหรือเปิดแบบ private: เริ่มใหม่ */ }
    return { state: defaultState(), changed: false };
  }

  const loaded = load();
  let state = loaded.state;
  let pending = null;      // { sellerId, code } ระหว่างกรอกจำนวนและราคา
  let sheetCode = null;    // การ์ดที่แตะไว้ในแผ่นเลือกคนขาย (จอแคบ)

  let cloud = null;        // ตัวซิงก์ข้ามเครื่อง (สร้างตอน init)

  // บันทึกในเบราว์เซอร์อย่างเดียว (ใช้กับสิ่งที่ไม่ต้องซิงก์ เช่นเด็คที่เปิดอยู่ และข้อมูลที่เพิ่งรับมาจากคลาวด์)
  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { toast('บันทึกไม่ได้ (พื้นที่เต็มหรือถูกบล็อก)'); }
  }

  function save() {
    saveLocal();
    if (cloud) cloud.markDirty();
  }

  function currentDeck() {
    return state.decks.find((d) => d.id === state.currentDeckId) || state.decks[0];
  }

  // คนขายของเด็คที่เปิดอยู่เท่านั้น เด็คอื่นมีลิสต์คนละชุด
  function deckSellers(deck = currentDeck()) {
    if (!Array.isArray(deck.sellers)) deck.sellers = [];
    return deck.sellers;
  }

  function cardName(code) {
    return (state.cards[code] && state.cards[code].name) || code;
  }

  // โฟลเดอร์เกมมีเฉพาะตอนเปิดจากไฟล์ในเครื่องหรือ localhost บนโฮสต์จะได้ 404 ทุกใบ
  const hasGameFolder = location.protocol === 'file:'
    || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

  // ลำดับรูปที่ลองใช้: รูปจากเกมในเครื่องก่อน (ถ้ามี) แล้วค่อยรูปจาก optcgapi
  function imageSources(code) {
    const api = state.cards[code] && state.cards[code].image;
    return [hasGameFolder && window.Cards.gameImage(code), api].filter(Boolean);
  }

  // <img onerror>: ลองรูปถัดไป ถ้าหมดแล้วเอารูปออกเพื่อให้เห็นชื่อการ์ดแทน
  window.nextImage = (img) => {
    const rest = (img.dataset.fallback || '').split('|').filter(Boolean);
    if (rest.length === 0) { img.remove(); return; }
    img.dataset.fallback = rest.slice(1).join('|');
    img.src = rest[0];
  };

  // ราคารวมของกล่องอยู่ที่เด็ค (sellerTotals) คนขายคนละเด็คเป็นคนละรายการ ไม่ใช้ชื่อ/ค่าส่งร่วมกัน
  function sellerTotal(sellerId) {
    const t = (currentDeck().sellerTotals || {})[sellerId];
    return typeof t === 'number' ? t : null;
  }

  // กล่องที่ยังเป็น "ข้อเสนอ" (ยังไม่ได้ตกลงซื้อ) เก็บต่อเด็ค · กล่องเก่าที่ไม่มีค่านี้ถือว่าซื้อแล้ว
  function isOffer(sellerId) {
    return !!(currentDeck().offers || {})[sellerId];
  }

  function setOffer(sellerId, offer) {
    const deck = currentDeck();
    deck.offers = deck.offers || {};
    if (offer) deck.offers[sellerId] = true;
    else delete deck.offers[sellerId];
  }

  function sellersForDeck() {
    return deckSellers().map((s) => {
      const total = sellerTotal(s.id);
      return { ...s, ...(total === null ? {} : { total }), offer: isOffer(s.id) };
    });
  }

  function summary() {
    return window.Buy.deckSummary(currentDeck(), sellersForDeck());
  }

  // ---------- helpers ----------

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function baht(n) {
    return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ฿';
  }

  function parseNum(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function art(code) {
    const [first, ...rest] = imageSources(code);
    // ไม่มีรูป หรือรูปโหลดไม่ได้: แสดงชื่อและรหัสแทน
    return `<div class="art"><div class="placeholder"><span>${esc(cardName(code))}</span><small>${esc(code)}</small></div>
      ${first ? `<img src="${esc(first)}" data-fallback="${esc(rest.join('|'))}" alt="${esc(cardName(code))}" loading="lazy" draggable="false" onerror="nextImage(this)">` : ''}</div>`;
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // ---------- render ----------

  function renderAll() {
    const s = summary();
    renderTopbar(s);
    renderDeck(s);
    renderBoxes(s);
    $('#mtab-deck').textContent = s.remaining.length === 0 ? '' : s.missingCount === 0 ? 'ครบ' : `ขาด ${s.missingCount}`;
    $('#mtab-sellers').textContent = s.total ? baht(s.total) : '';
  }

  // แท็บด้านล่างบนมือถือ (จำไว้ใน body เพื่อให้ CSS ซ่อนอีกฝั่ง)
  function showMobileTab(tab) {
    document.body.dataset.mtab = tab;
    document.querySelectorAll('[data-mtab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mtab === tab)));
    window.scrollTo(0, 0);
  }

  function renderTopbar(s) {
    const deck = currentDeck();
    $('#deck-select').innerHTML = state.decks.map((d) =>
      `<option value="${d.id}" ${d.id === deck.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
    $('#stat-card').textContent = baht(s.cardCost);
    $('#stat-ship').textContent = baht(s.shippingCost);
    $('#stat-total').textContent = baht(s.total);
    $('#stat-missing').textContent = s.remaining.length === 0 ? '–' : s.missingCount === 0 ? 'ครบ' : `${s.missingCount} ใบ`;
    const wrap = $('#stat-missing-wrap');
    wrap.classList.toggle('missing', s.missingCount > 0);
    wrap.classList.toggle('complete', s.remaining.length > 0 && s.missingCount === 0);
  }

  function renderDeck(s) {
    const deck = currentDeck();
    const total = deck.items.reduce((a, i) => a + i.qty, 0);
    $('#deck-count').textContent = total ? `${total} ใบ · ${deck.items.length} แบบ` : '';
    $('#pick-hint').textContent = narrow.matches
      ? 'แตะการ์ดเพื่อเลือกว่าได้จากใคร · กดค้างเพื่อดูรูปใหญ่'
      : 'ลากการ์ดไปวางในกล่องคนขาย · คลิกการ์ดเพื่อดูรูปใหญ่ · ลากไฟล์ .deck มาวางที่นี่เพื่อนำเข้า';

    if (s.remaining.length === 0) {
      $('#deck-grid').innerHTML = `<div class="empty"><b>ยังไม่มีการ์ดในเด็ค</b>
        พิมพ์รหัสด้านบน กดปุ่ม .deck หรือลากไฟล์ .deck มาวางตรงนี้</div>`;
      return;
    }
    $('#deck-grid').innerHTML = s.remaining.map((r) => {
      const hasBuys = deck.purchases.some((p) => p.code === r.code);
      const c = state.cards[r.code] || {};
      return `<div class="tile ${r.left === 0 ? 'done' : ''}"
          draggable="true" data-code="${esc(r.code)}" tabindex="0" title="${esc(cardName(r.code))}">
        ${art(r.code)}
        <span class="ribbon ${r.left === 0 ? 'ok' : ''}">${r.left === 0 ? '✓ ครบ' : `เหลือ ${r.left}`}</span>
        ${r.over ? `<span class="ribbon over">เกิน ${r.over}</span>` : ''}
        ${r.offers && r.left ? `<span class="offer-badge" title="มีข้อเสนอจาก ${r.offers} คน">ข้อเสนอ ${r.offers}</span>` : ''}
        <span class="badge-qty">×${r.need}</span>
        <button type="button" class="rm" data-action="rm-item" aria-label="ลบการ์ดออกจากเด็ค" ${hasBuys ? 'disabled' : ''}>✕</button>
        <div class="tile-cap"><span class="nm">${esc(cardName(r.code))}</span><span class="cd">${esc(r.code)}${c.rarity ? ` ${esc(c.rarity)}` : ''}</span></div>
      </div>`;
    }).join('');
  }

  function renderBoxes(s) {
    if (deckSellers().length === 0) {
      $('#boxes').innerHTML = `<div class="empty"><b>ยังไม่มีคนขาย</b>กด "+ คนขาย" เพื่อสร้างกล่องแรก</div>`;
      return;
    }
    $('#boxes').innerHTML = s.sellers.map((b) => {
      const seller = deckSellers().find((x) => x.id === b.id);
      const lump = sellerTotal(b.id);
      const pieces = b.lines.reduce((a, p) => a + p.qty, 0);
      return `<div class="box ${b.offer ? 'offer' : ''}" data-seller="${b.id}">
        <div class="box-head">
          <input class="name" data-field="name" value="${esc(seller.name)}" aria-label="ชื่อคนขาย">
          <div class="box-total">${baht(b.total)}</div>
          <div class="box-status">
            <button type="button" class="status-toggle ${b.offer ? 'is-offer' : 'is-bought'}" data-action="toggle-offer"
              title="${b.offer ? 'ยังเป็นข้อเสนอ ไม่นับในยอด · กดเมื่อตกลงซื้อแล้ว' : 'ตกลงซื้อแล้ว นับในยอด · กดเพื่อกลับเป็นข้อเสนอ'}">
              ${b.offer ? 'ข้อเสนอ' : '✓ ซื้อแล้ว'}</button>
            ${b.offer ? '<span class="muted">ไม่นับในยอด</span>' : ''}
          </div>
          <div class="box-fields">
            <label>ราคารวม <input type="number" min="0" step="any" data-field="total" value="${lump ?? ''}" placeholder="ทีละใบ"></label>
            <label>ค่าส่ง <input type="number" min="0" step="any" data-field="shipping" value="${seller.shipping}"></label>
            <button type="button" class="btn ghost rm-seller" data-action="rm-seller" aria-label="ลบคนขาย">ลบ</button>
          </div>
          ${b.lines.length ? `<div class="box-sub">${pieces} ใบ · ${lump !== null ? 'ราคารวม' : 'ค่าการ์ด'} ${baht(b.cardCost)} + ค่าส่ง ${baht(b.shipping)}</div>` : ''}
        </div>
        ${b.lines.length === 0 ? `<div class="drop-zone">${narrow.matches ? 'ไปที่แท็บ "การ์ด" แล้วแตะการ์ดเพื่อจัดเข้ากล่องนี้' : 'ลากการ์ดมาวางที่นี่'}</div>` : `
        <div class="mini-grid">
          ${b.lines.map((p) => `<div class="mini" data-id="${p.id}" data-code="${esc(p.code)}" title="${esc(cardName(p.code))}">
            ${art(p.code)}
            <span class="badge-qty">×${p.qty}</span>
            <button type="button" class="rm" data-action="rm-line" aria-label="ลบรายการ">✕</button>
            ${lump !== null ? '' : `<div class="price">${p.pricing === 'lot' ? `เหมา ${baht(p.price)}` : `${baht(p.price)}/ใบ`}</div>`}
          </div>`).join('')}
        </div>`}
      </div>`;
    }).join('');
  }

  function popBox(sellerId) {
    const box = $(`.box[data-seller="${sellerId}"]`);
    if (box) { box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop'); }
  }

  // ---------- card lookup ----------

  async function fetchCardInfo(code) {
    if (state.cards[code] && state.cards[code].name) return;
    try {
      const info = await window.Cards.lookupCard(code);
      if (info) state.cards[code] = info;
      else toast(`ไม่พบ ${code} ใน optcgapi`);
    } catch (_) {
      toast('ดึงข้อมูลการ์ดไม่ได้ ลองใหม่ภายหลัง');
    }
    save();
    scheduleRender();
  }

  // ข้อมูลการ์ดหลายใบมาถึงติดกัน: รวมให้วาดหน้าใหม่ครั้งเดียวต่อเฟรม รูปจะได้ไม่กระพริบ
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderAll(); });
  }

  // ---------- assign ----------

  function lastPrice(code) {
    for (let i = currentDeck().purchases.length - 1; i >= 0; i--) {
      const p = currentDeck().purchases[i];
      if (p.code === code && p.pricing !== 'lot') return p.price;
    }
    return '';
  }

  function syncPricingLabel() {
    const lot = $('#dlg-pricing').value === 'lot';
    $('#dlg-price-label').textContent = lot ? 'ราคารวมทั้งรายการ' : 'ราคาต่อใบ';
  }

  function leftOf(code) {
    const row = summary().remaining.find((r) => r.code === code);
    return row ? row.left : 0;
  }

  function assign(sellerId, code) {
    if (!deckSellers().some((x) => x.id === sellerId)) return;
    openAssign(sellerId, code);
  }

  // กล่องที่ตั้งราคารวมแล้ว: ถามแค่จำนวน (คนขายอาจมีให้ไม่ครบ) มีปุ่มเลือกเร็ว
  function openAssign(sellerId, code) {
    const seller = deckSellers().find((x) => x.id === sellerId);
    const left = leftOf(code);
    const lump = sellerTotal(sellerId) !== null;
    const deck = currentDeck();
    // กล่องใหม่ในเด็คนี้เริ่มเป็นข้อเสนอ (กล่องที่มีของอยู่แล้วคงสถานะเดิม)
    const offer = deck.purchases.some((p) => p.sellerId === sellerId) ? isOffer(sellerId) : true;
    pending = { sellerId, code, lump, offer };
    setImage($('#dlg-img'), code);
    $('#dlg-title').textContent = `${cardName(code)} → ${seller.name}${offer ? ' (ข้อเสนอ)' : ''}`;
    $('#dlg-qty-label').textContent = offer ? 'มีให้กี่ใบ' : 'จำนวน';
    $('#dlg-sub').textContent = `${code} · ${left > 0 ? `ยังเหลือ ${left} ใบในเด็ค` : 'ครบแล้ว ยังบันทึกเพิ่มได้'}`;
    $('#dlg-qty').value = left > 0 ? left : 1;
    $('#dlg-quick').innerHTML = Array.from({ length: Math.min(Math.max(left, 4), 8) }, (_, i) =>
      `<button type="button" class="btn chip ${i + 1 === left ? 'primary' : ''}" data-qty="${i + 1}">${i + 1}</button>`).join('');
    $('#dlg-price-row').hidden = lump;
    $('#dlg-price').required = !lump;
    $('#dlg-pricing').value = 'each';
    $('#dlg-price').value = lastPrice(code);
    syncPricingLabel();
    $('#dlg-error').hidden = true;
    $('#dlg').showModal();
    const focus = lump ? $('#dlg-qty') : $('#dlg-price');
    focus.focus();
    focus.select();
  }

  function submitAssign(e) {
    e.preventDefault();
    const { sellerId, code, lump, offer } = pending;
    const qty = parseNum($('#dlg-qty').value);
    const price = lump ? 0 : parseNum($('#dlg-price').value);
    const pricing = lump || $('#dlg-pricing').value === 'lot' ? 'lot' : 'each';
    const err = $('#dlg-error');
    if (qty === null || !Number.isInteger(qty) || qty < 1) { err.textContent = 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1'; err.hidden = false; return; }
    if (price === null) { err.textContent = pricing === 'lot' ? 'ราคารวมต้องเป็นตัวเลขที่ไม่ติดลบ' : 'ราคาต่อใบต้องเป็นตัวเลขที่ไม่ติดลบ'; err.hidden = false; return; }
    const deck = currentDeck();
    if (!deck.purchases.some((p) => p.sellerId === sellerId)) setOffer(sellerId, offer);
    // กล่องราคารวม: รวมกับการ์ดรหัสเดิมในกล่องเป็นรายการเดียว
    const line = lump && deck.purchases.find((p) => p.sellerId === sellerId && p.code === code);
    if (line) line.qty += qty;
    else deck.purchases.push({ id: uid(), sellerId, code, qty, price, pricing });
    pending = null;
    $('#dlg').close();
    save(); renderAll(); popBox(sellerId);
  }

  // ใช้กับ <img> ที่มีอยู่แล้วในหน้า (รูปในหน้าต่าง) ให้ลองรูปสำรองได้เหมือนกัน
  function setImage(img, code) {
    const [first, ...rest] = imageSources(code);
    img.dataset.fallback = rest.join('|');
    img.onerror = () => {
      const next = (img.dataset.fallback || '').split('|').filter(Boolean);
      if (next.length === 0) { img.removeAttribute('src'); return; }
      img.dataset.fallback = next.slice(1).join('|');
      img.src = next[0];
    };
    if (first) img.src = first;
    else img.removeAttribute('src');
  }

  function openPreview(code) {
    setImage($('#preview-img'), code);
    $('#preview-cap').textContent = `${cardName(code)} · ${code}`;
    $('#preview').showModal();
  }

  // ---------- events ----------

  function bindTopbar() {
    $('#deck-select').addEventListener('change', (e) => {
      state.currentDeckId = e.target.value;
      saveLocal(); renderAll(); // เด็คที่เปิดอยู่เป็นของแต่ละเครื่อง ไม่ซิงก์
    });
    $('#deck-new').addEventListener('click', () => {
      const d = newDeck(`เด็ค ${state.decks.length + 1}`);
      state.decks.push(d);
      state.currentDeckId = d.id;
      save(); renderAll();
    });
    $('#deck-rename').addEventListener('click', () => {
      const deck = currentDeck();
      const name = prompt('ชื่อเด็ค', deck.name);
      if (name === null) return;
      deck.name = name.trim() || 'เด็คไม่มีชื่อ';
      save(); renderAll();
    });
    $('#deck-delete').addEventListener('click', () => {
      const deck = currentDeck();
      if (!confirm(`ลบเด็ค "${deck.name}" และการจัดซื้อทั้งหมดในเด็คนี้?`)) return;
      state.decks = state.decks.filter((d) => d.id !== deck.id);
      if (state.decks.length === 0) state.decks.push(newDeck('เด็คใหม่'));
      state.currentDeckId = state.decks[0].id;
      save(); renderAll();
    });
    $('#btn-theme').addEventListener('click', () => {
      const light = document.documentElement.dataset.theme !== 'light';
      if (light) document.documentElement.dataset.theme = 'light';
      else delete document.documentElement.dataset.theme;
      try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch (_) { /* ไม่จำธีมก็ได้ */ }
    });
  }

  function bindDeck() {
    $('#add-card').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = window.Cards.normalizeCode($('#add-code').value);
      const qty = Math.floor(parseNum($('#add-qty').value) || 0);
      if (!code) return;
      if (qty < 1) { toast('จำนวนต้องเป็น 1 ขึ้นไป'); return; }
      const deck = currentDeck();
      const item = deck.items.find((i) => i.code === code);
      if (item) item.qty += qty;
      else deck.items.push({ code, qty });
      $('#add-code').value = '';
      save(); renderAll();
      $('#add-code').focus();
      fetchCardInfo(code);
    });

    const grid = $('#deck-grid');
    grid.addEventListener('dragstart', (e) => {
      const tile = e.target.closest('.tile');
      if (!tile) return;
      e.dataTransfer.setData('text/plain', tile.dataset.code);
      e.dataTransfer.effectAllowed = 'copy';
      const img = tile.querySelector('img');
      if (img && img.complete) e.dataTransfer.setDragImage(img, img.width / 2, img.height / 3);
      tile.classList.add('dragging');
    });
    grid.addEventListener('dragend', (e) => {
      const tile = e.target.closest('.tile');
      if (tile) tile.classList.remove('dragging');
    });
    grid.addEventListener('click', (e) => {
      const tile = e.target.closest('.tile');
      if (!tile) return;
      const code = tile.dataset.code;
      if (e.target.closest('[data-action="rm-item"]')) {
        const deck = currentDeck();
        if (deck.purchases.some((p) => p.code === code)) { toast('ลบการ์ดใบนี้ออกจากกล่องคนขายก่อน'); return; }
        deck.items = deck.items.filter((i) => i.code !== code);
        save(); renderAll();
        return;
      }
      if (longPressed) { longPressed = false; return; }
      if (narrow.matches) openSheet(code);
      else openPreview(code);
    });

    // กดค้างที่การ์ด (มือถือ) = ดูรูปใหญ่
    let pressTimer = null;
    let longPressed = false;
    const cancelPress = () => clearTimeout(pressTimer);
    grid.addEventListener('pointerdown', (e) => {
      const tile = e.target.closest('.tile');
      if (!tile || e.pointerType === 'mouse' || e.target.closest('button')) return;
      longPressed = false;
      pressTimer = setTimeout(() => { longPressed = true; openPreview(tile.dataset.code); }, 450);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => grid.addEventListener(ev, cancelPress));
    grid.addEventListener('contextmenu', (e) => { if (e.target.closest('.tile') && narrow.matches) e.preventDefault(); });
    grid.addEventListener('keydown', (e) => {
      const tile = e.target.closest('.tile');
      if (tile && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPreview(tile.dataset.code); }
    });

    // ลากไฟล์ .deck จากเครื่องมาวางบนฝั่งซ้าย
    const pane = $('#deck-pane');
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    pane.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      pane.classList.add('file-over');
    });
    pane.addEventListener('dragleave', (e) => {
      if (!pane.contains(e.relatedTarget)) pane.classList.remove('file-over');
    });
    pane.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      pane.classList.remove('file-over');
      const file = e.dataTransfer.files[0];
      if (file) importDeckFile(file);
    });
  }

  function bindBoxes() {
    const root = $('#boxes');

    root.addEventListener('dragover', (e) => {
      const box = e.target.closest('.box');
      if (!box || ![...e.dataTransfer.types].includes('text/plain')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      box.classList.add('over');
    });
    root.addEventListener('dragleave', (e) => {
      const box = e.target.closest('.box');
      if (box && !box.contains(e.relatedTarget)) box.classList.remove('over');
    });
    root.addEventListener('drop', (e) => {
      const box = e.target.closest('.box');
      if (!box) return;
      e.preventDefault();
      box.classList.remove('over');
      const code = e.dataTransfer.getData('text/plain');
      if (code && currentDeck().items.some((i) => i.code === code)) assign(box.dataset.seller, code);
    });

    root.addEventListener('click', (e) => {
      const t = e.target;
      const box = t.closest('.box');
      if (!box) return;
      if (t.dataset.action === 'rm-line') {
        const id = t.closest('.mini').dataset.id;
        currentDeck().purchases = currentDeck().purchases.filter((p) => p.id !== id);
        save(); renderAll();
        return;
      }
      if (t.dataset.action === 'rm-seller') {
        const id = box.dataset.seller;
        const deck = currentDeck();
        const seller = deckSellers(deck).find((x) => x.id === id);
        if (!seller) return;
        if (!confirm(`ลบคนขาย "${seller.name}" และการจัดซื้อจากคนนี้ในเด็คนี้?`)) return;
        deck.sellers = deck.sellers.filter((x) => x.id !== id);
        deck.purchases = deck.purchases.filter((p) => p.sellerId !== id);
        if (deck.sellerTotals) delete deck.sellerTotals[id];
        if (deck.offers) delete deck.offers[id];
        save(); renderAll();
        return;
      }
      const toggle = t.closest('[data-action="toggle-offer"]');
      if (toggle) {
        const id = box.dataset.seller;
        setOffer(id, !isOffer(id));
        save(); renderAll(); popBox(id);
        return;
      }
      if (t.closest('button, input, label')) return;
      const mini = t.closest('.mini');
      if (mini) openPreview(mini.dataset.code);
    });

    root.addEventListener('change', (e) => {
      const box = e.target.closest('.box');
      if (!box) return;
      const seller = deckSellers().find((x) => x.id === box.dataset.seller);
      if (e.target.dataset.field === 'name') seller.name = e.target.value.trim() || 'คนขายไม่มีชื่อ';
      if (e.target.dataset.field === 'shipping') seller.shipping = parseNum(e.target.value) ?? 0;
      if (e.target.dataset.field === 'total') {
        const deck = currentDeck();
        deck.sellerTotals = deck.sellerTotals || {};
        const v = parseNum(e.target.value);
        if (v === null) delete deck.sellerTotals[seller.id];
        else deck.sellerTotals[seller.id] = v;
      }
      save(); renderAll();
    });

    $('#seller-add').addEventListener('click', () => {
      const sellers = deckSellers();
      sellers.push({ id: uid(), name: `คนขาย ${sellers.length + 1}`, shipping: 0 });
      save(); renderAll();
      const names = root.querySelectorAll('input[data-field="name"]');
      const last = names[names.length - 1];
      last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      last.select();
    });
  }

  function bindDialogs() {
    $('#dlg-form').addEventListener('submit', submitAssign);
    $('#dlg-pricing').addEventListener('change', syncPricingLabel);
    // ปุ่มจำนวนเร็ว: กล่องราคารวมบันทึกทันที กล่องปกติแค่ตั้งจำนวนแล้วรอกรอกราคา
    $('#dlg-quick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-qty]');
      if (!b) return;
      $('#dlg-qty').value = b.dataset.qty;
      if (pending && pending.lump) $('#dlg-form').requestSubmit();
      else $('#dlg-price').focus();
    });
    $('#dlg-cancel').addEventListener('click', () => { pending = null; $('#dlg').close(); });
    // คลิกที่ใดก็ได้ในหน้าดูรูปใหญ่เพื่อปิด
    $('#preview').addEventListener('click', () => $('#preview').close());
  }

  // ---------- เทียบราคา: หาแผนซื้อที่ถูกที่สุดจากกล่องข้อเสนอ ----------

  let currentPlan = null;

  // ข้อเสนอที่ส่งให้ตัวคำนวณ: กล่องที่ยังเป็นข้อเสนอและมีของ (เซ็ต = กล่องที่ตั้งราคารวม)
  function offerSellers() {
    const deck = currentDeck();
    return sellersForDeck()
      .filter((s) => s.offer)
      .map((s) => ({ id: s.id, shipping: s.shipping, ...(typeof s.total === 'number' ? { total: s.total } : {}), lines: deck.purchases.filter((p) => p.sellerId === s.id) }))
      .filter((s) => s.lines.length);
  }

  function renderPlan() {
    const body = $('#plan-body');
    const s = summary();
    const offers = offerSellers();
    const needs = s.remaining.filter((r) => r.left > 0).map((r) => ({ code: r.code, left: r.left }));
    currentPlan = null;
    $('#plan-confirm').disabled = true;
    if (needs.length === 0) { body.innerHTML = '<p class="empty"><b>ครบแล้ว</b>การ์ดในเด็คได้ครบจากกล่องที่ซื้อแล้ว</p>'; return; }
    if (offers.length === 0) {
      body.innerHTML = `<p class="empty"><b>ยังไม่มีข้อเสนอ</b>สร้างกล่องคนขาย แล้วใส่การ์ดกับราคาที่เขาเสนอ
        (กล่องใหม่จะเป็น "ข้อเสนอ" อยู่แล้ว) ใส่การ์ดใบเดียวกันได้หลายกล่อง</p>`;
      return;
    }
    const plan = window.Plan.planBuy({ needs, sellers: offers });
    currentPlan = plan;
    const nameOf = (id) => (deckSellers().find((x) => x.id === id) || {}).name || '?';
    const needTotal = needs.reduce((a, n) => a + n.left, 0);
    const missingTotal = plan.missing.reduce((a, m) => a + m.qty, 0);
    body.innerHTML = `
      ${plan.exact ? '' : '<p class="warn-note">ข้อเสนอเยอะมาก ใช้วิธีคำนวณแบบประมาณ แผนนี้อาจไม่ใช่ราคาต่ำสุดจริง</p>'}
      <div class="plan-sum">
        <div><span>ได้การ์ด</span><b>${needTotal - missingTotal}/${needTotal} ใบ</b></div>
        <div><span>ค่าการ์ด</span><b>${baht(plan.cardCost)}</b></div>
        <div><span>ค่าส่ง</span><b>${baht(plan.shippingCost)}</b></div>
        <div class="grand"><span>รวมทั้งแผน</span><b>${baht(plan.total)}</b></div>
      </div>
      ${plan.missing.length ? `<p class="warn-note">ยังไม่มีใครเสนอ: ${plan.missing.map((m) => `${esc(cardName(m.code))} ×${m.qty}`).join(', ')}</p>` : ''}
      ${plan.sellers.map((b) => `<div class="plan-seller">
        <div class="order-head"><h3>${esc(nameOf(b.id))}${b.isSet ? ' <span class="muted">· เซ็ตทั้งกล่อง</span>' : ''}</h3><b>${baht(b.total)}</b></div>
        <div class="plan-lines">
          ${b.lines.map((l) => `<div class="plan-line" data-code="${esc(l.code)}">${art(l.code)}<div>
            <div class="nm">${esc(cardName(l.code))}</div>
            <div class="muted">${esc(l.code)} · ×${l.qty}${b.isSet ? '' : l.whole ? ` · เหมา ${baht(l.price)}` : ` · ${baht(l.price)}/ใบ`}</div>
          </div></div>`).join('')}
        </div>
        <div class="muted">ค่าการ์ด ${baht(b.cardCost)} + ค่าส่ง ${baht(b.shipping)}</div>
      </div>`).join('')}
      ${plan.extra.length ? `<p class="muted">ได้เกินจากเซ็ต/เหมา (แถม): ${plan.extra.map((x) => `${esc(cardName(x.code))} ×${x.qty}`).join(', ')}</p>` : ''}
      ${plan.sellers.length ? '' : '<p class="empty">ไม่มีข้อเสนอที่ช่วยได้</p>'}`;
    $('#plan-confirm').disabled = plan.sellers.length === 0;
  }

  // ซื้อตามแผน: กล่องที่ถูกเลือกเป็น "ซื้อแล้ว" จำนวนตามแผน การ์ดที่แผนไม่ใช้ถูกเอาออกจากกล่องนั้น
  function confirmPlan() {
    if (!currentPlan) return;
    const deck = currentDeck();
    for (const b of currentPlan.sellers) {
      setOffer(b.id, false);
      if (b.isSet) continue; // เซ็ตซื้อทั้งกล่องตามเดิม
      const taken = new Map(b.lines.map((l) => [l.lineId, l]));
      deck.purchases = deck.purchases.flatMap((p) => {
        if (p.sellerId !== b.id) return [p];
        const t = taken.get(p.id);
        if (!t) return [];
        return [t.whole ? p : { ...p, qty: t.qty }];
      });
    }
    $('#plan-dlg').close();
    save(); renderAll();
    toast('ยืนยันซื้อตามแผนแล้ว · กล่องที่ไม่ได้เลือกยังเป็นข้อเสนอ');
  }

  function bindPlan() {
    $('#btn-plan').addEventListener('click', () => {
      $('#plan-body').innerHTML = '<p class="muted">กำลังคำนวณ…</p>';
      $('#plan-dlg').showModal();
      // ให้หน้าต่างแสดงก่อน แล้วค่อยคำนวณ (ข้อเสนอเยอะอาจใช้เวลาเกือบวินาที)
      setTimeout(renderPlan, 30);
    });
    $('#plan-close').addEventListener('click', () => $('#plan-dlg').close());
    $('#plan-confirm').addEventListener('click', () => {
      if (!confirm('ยืนยันซื้อตามแผนนี้? กล่องที่ถูกเลือกจะเปลี่ยนเป็น "ซื้อแล้ว" และปรับจำนวนตามแผน')) return;
      confirmPlan();
    });
    $('#plan-body').addEventListener('click', (e) => {
      const line = e.target.closest('.plan-line');
      if (line) openPreview(line.dataset.code);
    });
  }

  // ---------- มือถือ: แผ่นเลือกคนขาย เมนู แท็บ ----------

  function openSheet(code) {
    sheetCode = code;
    const s = summary();
    const row = s.remaining.find((r) => r.code === code);
    setImage($('#sheet-img'), code);
    $('#sheet-title').textContent = cardName(code);
    $('#sheet-sub').textContent = `${code} · ${row && row.left > 0 ? `ยังขาด ${row.left} ใบ` : 'ครบแล้ว'}`;
    $('#sheet-list').innerHTML = s.sellers.map((b) => {
      const has = b.lines.filter((p) => p.code === code).reduce((a, p) => a + p.qty, 0);
      return `<button type="button" class="seller-pick" data-seller="${b.id}">
        <span>${esc(b.name)}<small>${b.lines.length && b.offer ? 'ข้อเสนอ · ' : ''}${has ? `มีใบนี้แล้ว ×${has} · ` : ''}${b.lines.length} รายการ</small></span>
        <b>${baht(b.total)}</b>
      </button>`;
    }).join('') + '<button type="button" class="seller-pick new" data-seller="new">+ คนขายใหม่</button>';
    $('#sheet').showModal();
  }

  function bindMobile() {
    document.querySelectorAll('[data-mtab]').forEach((b) => b.addEventListener('click', () => showMobileTab(b.dataset.mtab)));

    $('#sheet-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-seller]');
      if (!b || !sheetCode) return;
      let sellerId = b.dataset.seller;
      if (sellerId === 'new') {
        const sellers = deckSellers();
        const name = prompt('ชื่อคนขาย', `คนขาย ${sellers.length + 1}`);
        if (name === null) return;
        sellerId = uid();
        sellers.push({ id: sellerId, name: name.trim() || 'คนขายไม่มีชื่อ', shipping: 0 });
        save(); renderAll();
      }
      const code = sheetCode;
      $('#sheet').close();
      assign(sellerId, code);
    });
    $('#sheet-close').addEventListener('click', () => $('#sheet').close());
    $('#sheet-preview').addEventListener('click', () => { $('#sheet').close(); openPreview(sheetCode); });
    $('#sheet').addEventListener('close', () => { sheetCode = null; });

    $('#btn-menu').addEventListener('click', () => $('#menu').showModal());
    $('#menu-close').addEventListener('click', () => $('#menu').close());
    // ปุ่มในเมนูกดปุ่มเดิมบนจอคอมแทน (ฟังก์ชันเดียวกัน)
    $('#menu').addEventListener('click', (e) => {
      const b = e.target.closest('[data-proxy]');
      if (!b) return;
      $('#menu').close();
      document.getElementById(b.dataset.proxy).click();
    });
    // แตะพื้นหลังรอบแผ่นเพื่อปิด
    for (const id of ['#sheet', '#menu']) {
      $(id).addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
    }
  }

  // ---------- ส่งออกรูปการ์ดที่ยังขาด ----------

  // รูปสำหรับวาดลงภาพส่งออก ต้องมาจากโดเมนเดียวกัน (รูปจาก optcgapi ตรง ๆ วาดไม่ได้เพราะไม่มี CORS):
  // รูปจากเกมในเครื่อง (start.bat) → /api/img บนเว็บ (ดึงจาก optcgapi ฝั่งเซิร์ฟเวอร์) → ลองตรง ๆ เผื่อได้
  function shotSources(code) {
    const proxy = location.protocol === 'file:' ? null : `/api/img?code=${encodeURIComponent(code)}`;
    return [hasGameFolder && window.Cards.gameImage(code), proxy, state.cards[code] && state.cards[code].image].filter(Boolean);
  }

  async function exportShot() {
    const deck = currentDeck();
    const s = summary();
    const cards = s.remaining.filter((r) => r.left > 0)
      .map((r) => ({ code: r.code, name: cardName(r.code), left: r.left, sources: shotSources(r.code) }));
    if (cards.length === 0) { toast(s.remaining.length ? 'ครบทุกใบแล้ว ไม่มีการ์ดที่ขาด' : 'ยังไม่มีการ์ดในเด็ค'); return; }
    toast('กำลังสร้างรูป…');
    const date = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
    const blob = await window.Shot.render({
      title: `${deck.name} · ยังขาด ${s.missingCount} ใบ`,
      subtitle: `${cards.length} แบบ · ${date}`,
      cards,
    });
    const file = new File([blob], `${deck.name.replace(/[\\/:*?"<>|]+/g, '_')}-ขาด.jpg`, { type: 'image/jpeg' });
    // มือถือ: เปิดหน้าแชร์ (ส่งเข้า LINE/Messenger ได้ทันที) ถ้าไม่ได้ค่อยดาวน์โหลด
    if (narrow.matches && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('ดาวน์โหลดรูปแล้ว');
  }

  // ---------- import .deck ----------

  // เพิ่มการ์ดจากไฟล์ .deck หรือข้อความที่วาง (deck list / HTML ของ oplaytcg) เข้าเด็คปัจจุบัน
  // คืน true ถ้าเพิ่มได้อย่างน้อยหนึ่งใบ
  function addDeckText(text) {
    const { items, skipped } = window.Cards.parseDeckInput(text);
    if (items.length === 0) {
      toast(skipped.length ? `อ่านไม่ได้: ${skipped[0].slice(0, 60)}` : 'ไม่พบการ์ด');
      return false;
    }
    const deck = currentDeck();
    const codes = [];
    for (const { code, qty } of items) {
      const item = deck.items.find((i) => i.code === code);
      if (item) item.qty += qty;
      else deck.items.push({ code, qty });
      if (!codes.includes(code)) codes.push(code);
    }
    save(); renderAll();
    const total = items.reduce((a, i) => a + i.qty, 0);
    toast(`นำเข้า ${total} ใบ (${codes.length} แบบ)${skipped.length ? ` · ข้าม ${skipped.length} บรรทัด` : ''}`);
    codes.forEach((code) => fetchCardInfo(code));
    return true;
  }

  function importDeckFile(file) {
    const reader = new FileReader();
    reader.onload = () => addDeckText(reader.result);
    reader.readAsText(file);
  }

  function bindPaste() {
    const dlg = $('#paste-dlg');
    const text = $('#paste-text');
    const updatePreview = () => {
      const { items, skipped } = window.Cards.parseDeckInput(text.value);
      const total = items.reduce((a, i) => a + i.qty, 0);
      $('#paste-preview').textContent = text.value.trim()
        ? `พบ ${total} ใบ (${items.length} แบบ)${skipped.length ? ` · อ่านไม่ได้ ${skipped.length} บรรทัด` : ''}`
        : '';
    };
    $('#btn-paste').addEventListener('click', () => {
      text.value = '';
      updatePreview();
      dlg.showModal();
      text.focus();
    });
    text.addEventListener('input', updatePreview);
    $('#paste-cancel').addEventListener('click', () => dlg.close());
    $('#paste-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (addDeckText(text.value)) dlg.close();
    });
  }

  // ---------- บันทึกขึ้นเซิร์ฟเวอร์ (Turso) + ประวัติ / กู้คืน ----------

  const SAVE_TEXT = {
    idle: ['กำลังโหลด…', 'กำลังโหลดข้อมูลจากเซิร์ฟเวอร์'],
    saving: ['กำลังบันทึก…', 'กำลังบันทึกขึ้นเซิร์ฟเวอร์'],
    saved: ['บันทึกแล้ว', 'บันทึกแล้ว เปิดจากเครื่องไหนก็เห็นข้อมูลชุดนี้'],
    pending: ['กำลังบันทึก…', 'มีการแก้ไข กำลังจะบันทึก'],
    offline: ['ออฟไลน์', 'ออฟไลน์ แก้ต่อได้ ข้อมูลเก็บไว้ในเครื่อง จะบันทึกเมื่อมีเน็ต'],
    unavailable: ['เก็บในเครื่อง', 'เวอร์ชันนี้ไม่มีเซิร์ฟเวอร์ ข้อมูลเก็บไว้ในเครื่องนี้เท่านั้น'],
  };

  function saveText(status, detail) {
    if (status === 'error') {
      return detail === 'not_configured'
        ? ['ยังไม่ตั้งค่า', 'ฝั่งเซิร์ฟเวอร์ยังไม่ได้ตั้ง TURSO_DATABASE_URL / TURSO_AUTH_TOKEN ข้อมูลเก็บไว้ในเครื่องก่อน']
        : ['บันทึกไม่ได้', `บันทึกไม่ได้ (${detail}) ข้อมูลยังอยู่ในเครื่อง จะลองใหม่`];
    }
    return SAVE_TEXT[status] || ['', ''];
  }

  function renderSaveStatus(status, detail) {
    const [short, long] = saveText(status, detail);
    document.querySelectorAll('.cloud-dot').forEach((d) => { d.dataset.state = status; });
    $('#save-label').textContent = short;
    $('#btn-save').title = `${long} · คลิกเพื่อดูประวัติ / กู้คืน`;
    $('#menu-save-state').textContent = `· ${short}`;
    $('#save-state').textContent = long;
  }

  const REASON_TEXT = {
    auto: 'สำรองอัตโนมัติ',
    overwritten: 'ถูกทับโดยการแก้ที่ใหม่กว่า',
    lost: 'แก้จากอีกเครื่องที่เก่ากว่า (ไม่ได้ใช้)',
    before_restore: 'ก่อนกู้คืน',
  };

  const when = (t) => new Date(t).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  async function renderHistory() {
    const list = $('#history-list');
    list.innerHTML = '<p class="muted">กำลังโหลด…</p>';
    let items;
    try {
      items = await cloud.listHistory();
    } catch (e) {
      list.innerHTML = `<p class="muted">โหลดประวัติไม่ได้ (${esc(e.message === 'offline' ? 'ออฟไลน์' : e.message)})</p>`;
      return;
    }
    if (items.length === 0) {
      list.innerHTML = '<p class="muted">ยังไม่มีประวัติ จะเริ่มสำรองเมื่อมีการแก้ไขครั้งต่อไป</p>';
      return;
    }
    list.innerHTML = items.map((h) => `<div class="history-item">
      <div>
        <b>${esc(when(h.savedAt))}</b> <span class="muted">· ${esc(REASON_TEXT[h.reason] || h.reason)}</span>
        <div class="muted">${h.summary.decks} เด็ค · ${h.summary.cards} ใบ · จัดแล้ว ${h.summary.placed} ใบ · ${h.summary.sellers} คนขาย
          ${h.editedAt ? ` · แก้ล่าสุด ${esc(when(h.editedAt))}` : ''}</div>
      </div>
      <button type="button" class="btn" data-restore="${h.id}">กู้คืน</button>
    </div>`).join('');
  }

  function bindSave() {
    const dlg = $('#history-dlg');
    $('#btn-save').addEventListener('click', () => {
      const st = cloud.getStatus();
      renderSaveStatus(st.status, st.detail);
      dlg.showModal();
      renderHistory();
    });
    $('#history-close').addEventListener('click', () => dlg.close());
    $('#history-list').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-restore]');
      if (!b) return;
      if (!confirm('กู้คืนชุดนี้เป็นข้อมูลล่าสุด? ชุดปัจจุบันจะถูกสำรองไว้ในประวัติก่อน')) return;
      b.disabled = true;
      try {
        await cloud.restore(b.dataset.restore);
        dlg.close();
        toast('กู้คืนแล้ว');
      } catch (err) {
        b.disabled = false;
        toast(`กู้คืนไม่ได้ (${err.message === 'offline' ? 'ออฟไลน์' : err.message})`);
      }
    });

    // กลับมาที่แท็บหรือกลับมาออนไลน์ → ดึงของใหม่ / ส่งของค้าง
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') cloud.sync();
    });
    window.addEventListener('online', () => cloud.sync());
  }

  function initSave() {
    // เปิดไฟล์ตรง ๆ (file://) ไม่มีเซิร์ฟเวอร์ เก็บในเครื่องอย่างเดียว ซ่อนปุ่มประวัติ
    if (location.protocol === 'file:') {
      document.querySelectorAll('[data-cloud]').forEach((el) => { el.hidden = true; });
      document.querySelectorAll('.cloud-dot').forEach((d) => { d.dataset.state = 'off'; });
      cloud = { markDirty() {}, sync() {} };
      return;
    }
    cloud = window.Cloud.create({
      // เด็คที่เปิดอยู่เป็นของแต่ละเครื่อง — ส่งขึ้นเซิร์ฟเวอร์เฉพาะข้อมูลที่ย้ายเป็นคนขายต่อเด็คแล้ว
      getData: () => {
        const keep = state.currentDeckId;
        const { currentDeckId, ...rest } = state;
        const { state: next, changed } = window.Sellers.migrate(rest);
        if (changed) {
          state = { ...next, currentDeckId: keep };
          saveLocal();
        }
        return next;
      },
      applyData: (data) => {
        if (!isValidState(data)) { toast('ข้อมูลจากเซิร์ฟเวอร์ผิดรูปแบบ ไม่ได้นำมาใช้'); return false; }
        const keep = state.currentDeckId;
        const { state: next, changed } = window.Sellers.migrate({ cards: {}, ...data });
        next.currentDeckId = next.decks.some((d) => d.id === keep) ? keep : next.decks[0].id;
        state = next;
        saveLocal();
        renderAll();
        return changed;
      },
      // เซิร์ฟเวอร์ยังเป็นลิสต์คนขายกลาง และเวอร์ชันตรงกับเครื่องนี้ → บันทึกชุดที่ย้ายแล้วทับได้
      shouldResave: (data) => window.Sellers.migrate(data).changed,
      isPristine: () => state.decks.every((d) => (d.sellers || []).length === 0 && d.items.length === 0 && d.purchases.length === 0),
      onStatus: renderSaveStatus,
      onNotice: () => toast('ใช้ข้อมูลล่าสุดจากอีกเครื่อง · ชุดของเครื่องนี้เก็บไว้ในประวัติ'),
    });
    bindSave();
    renderSaveStatus('idle', '');
    cloud.start();
  }

  // ---------- export / import ----------

  function exportData() {
    const { state: next, changed } = window.Sellers.migrate(state);
    if (changed) { state = next; save(); }
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `optcg-deck-buyer-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (_) { data = null; }
      if (!isValidState(data)) { toast('ไฟล์ไม่ถูกต้อง ข้อมูลเดิมยังอยู่'); return; }
      if (!confirm('นำเข้าข้อมูลนี้แทนข้อมูลปัจจุบันทั้งหมด?')) return;
      // ไฟล์เก่าที่คนขายอยู่ลิสต์กลาง จะถูกย้ายให้แยกต่อเด็คก่อนบันทึก
      const { state: next } = window.Sellers.migrate({ cards: {}, ...data });
      state = next;
      if (!state.decks.some((d) => d.id === state.currentDeckId)) state.currentDeckId = state.decks[0].id;
      save(); renderAll();
      toast('นำเข้าแล้ว');
    };
    reader.readAsText(file);
  }

  // ---------- init ----------

  try { if (localStorage.getItem(THEME_KEY) === 'light') document.documentElement.dataset.theme = 'light'; } catch (_) { /* ใช้ธีมมืด */ }
  $('#btn-export').addEventListener('click', exportData);
  $('#file-import').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
  $('#file-deck').addEventListener('change', (e) => { if (e.target.files[0]) importDeckFile(e.target.files[0]); e.target.value = ''; });
  bindTopbar();
  bindDeck();
  bindBoxes();
  bindDialogs();
  bindPaste();
  $('#btn-shot').addEventListener('click', exportShot);
  bindPlan();
  bindMobile();
  showMobileTab('deck');
  narrow.addEventListener('change', renderAll);
  renderAll();
  // เก็บรูปแบบคนขายต่อเด็คไว้ในเครื่องก่อนซิงก์ ยังไม่ markDirty ที่นี่ กันทับข้อมูลที่ใหม่กว่าบนเซิร์ฟเวอร์
  if (loaded.changed) saveLocal();
  initSave();
  // ดึงชื่อ/รูปของการ์ดที่ยังไม่มีข้อมูล
  const codes = new Set(state.decks.flatMap((d) => d.items.map((i) => i.code)));
  codes.forEach((code) => fetchCardInfo(code));
})();
