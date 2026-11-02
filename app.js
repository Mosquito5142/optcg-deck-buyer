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
    return { id: uid(), name, items: [], purchases: [] };
  }

  function defaultState() {
    const deck = newDeck('เด็คใหม่');
    return { sellers: [], decks: [deck], currentDeckId: deck.id, cards: {} };
  }

  function isValidState(s) {
    return s && Array.isArray(s.sellers) && Array.isArray(s.decks) && s.decks.length > 0
      && s.decks.every((d) => Array.isArray(d.items) && Array.isArray(d.purchases));
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (isValidState(s)) return { cards: {}, ...s };
    } catch (_) { /* ข้อมูลเสียหรือเปิดแบบ private: เริ่มใหม่ */ }
    return defaultState();
  }

  let state = load();
  let selectedCode = null; // การ์ดที่แตะเลือกไว้ (จอแคบ)
  let pending = null;      // { sellerId, code } ระหว่างกรอกจำนวนและราคา

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { toast('บันทึกไม่ได้ (พื้นที่เต็มหรือถูกบล็อก)'); }
  }

  function currentDeck() {
    return state.decks.find((d) => d.id === state.currentDeckId) || state.decks[0];
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

  // ราคารวมที่ตกลงกับคนขายเก็บแยกต่อเด็ค เพราะคนขายคนเดียวกันใช้ได้หลายเด็ค
  function sellerTotal(sellerId) {
    const t = (currentDeck().sellerTotals || {})[sellerId];
    return typeof t === 'number' ? t : null;
  }

  function summary() {
    const sellers = state.sellers.map((s) => {
      const total = sellerTotal(s.id);
      return total === null ? s : { ...s, total };
    });
    return window.Buy.deckSummary(currentDeck(), sellers);
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
    $('#pick-hint').textContent = selectedCode
      ? `เลือก ${cardName(selectedCode)} แล้ว แตะกล่องคนขายเพื่อจัด · แตะการ์ดเดิมเพื่อยกเลิก`
      : narrow.matches
        ? 'แตะการ์ดแล้วแตะกล่องคนขาย'
        : 'ลากการ์ดไปวางในกล่องคนขาย · คลิกการ์ดเพื่อดูรูปใหญ่ · ลากไฟล์ .deck มาวางที่นี่เพื่อนำเข้า';

    if (s.remaining.length === 0) {
      $('#deck-grid').innerHTML = `<div class="empty"><b>ยังไม่มีการ์ดในเด็ค</b>
        พิมพ์รหัสด้านบน กดปุ่ม .deck หรือลากไฟล์ .deck มาวางตรงนี้</div>`;
      return;
    }
    $('#deck-grid').innerHTML = s.remaining.map((r) => {
      const hasBuys = deck.purchases.some((p) => p.code === r.code);
      const c = state.cards[r.code] || {};
      return `<div class="tile ${r.left === 0 ? 'done' : ''} ${r.code === selectedCode ? 'selected' : ''}"
          draggable="true" data-code="${esc(r.code)}" tabindex="0" title="${esc(cardName(r.code))}">
        ${art(r.code)}
        <span class="ribbon ${r.left === 0 ? 'ok' : ''}">${r.left === 0 ? '✓ ครบ' : `เหลือ ${r.left}`}</span>
        ${r.over ? `<span class="ribbon over">เกิน ${r.over}</span>` : ''}
        <span class="badge-qty">×${r.need}</span>
        <button type="button" class="rm" data-action="rm-item" aria-label="ลบการ์ดออกจากเด็ค" ${hasBuys ? 'disabled' : ''}>✕</button>
        <div class="tile-cap"><span class="nm">${esc(cardName(r.code))}</span><span class="cd">${esc(r.code)}${c.rarity ? ` ${esc(c.rarity)}` : ''}</span></div>
      </div>`;
    }).join('');
  }

  function renderBoxes(s) {
    if (state.sellers.length === 0) {
      $('#boxes').innerHTML = `<div class="empty"><b>ยังไม่มีคนขาย</b>กด "+ คนขาย" เพื่อสร้างกล่องแรก</div>`;
      return;
    }
    $('#boxes').innerHTML = s.sellers.map((b) => {
      const seller = state.sellers.find((x) => x.id === b.id);
      const lump = sellerTotal(b.id);
      const pieces = b.lines.reduce((a, p) => a + p.qty, 0);
      return `<div class="box ${selectedCode ? 'armed' : ''}" data-seller="${b.id}">
        <div class="box-head">
          <input class="name" data-field="name" value="${esc(seller.name)}" aria-label="ชื่อคนขาย">
          <div class="box-total">${baht(b.total)}</div>
          <div class="box-fields">
            <label>ราคารวม <input type="number" min="0" step="any" data-field="total" value="${lump ?? ''}" placeholder="ทีละใบ"></label>
            <label>ค่าส่ง <input type="number" min="0" step="any" data-field="shipping" value="${seller.shipping}"></label>
            <button type="button" class="btn ghost rm-seller" data-action="rm-seller" aria-label="ลบคนขาย">ลบ</button>
          </div>
          ${b.lines.length ? `<div class="box-sub">${pieces} ใบ · ${lump !== null ? 'ราคารวม' : 'ค่าการ์ด'} ${baht(b.cardCost)} + ค่าส่ง ${baht(b.shipping)}</div>` : ''}
        </div>
        ${b.lines.length === 0 ? `<div class="drop-zone">${narrow.matches ? 'แตะการ์ดแล้วแตะกล่องนี้' : 'ลากการ์ดมาวางที่นี่'}</div>` : `
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

  // กล่องที่ตั้งราคารวมแล้ว: เพิ่มจำนวนที่เหลือทันที รวมกับรายการรหัสเดิมในกล่อง
  function assign(sellerId, code) {
    if (!state.sellers.some((x) => x.id === sellerId)) return;
    if (sellerTotal(sellerId) === null) { openAssign(sellerId, code); return; }
    const left = leftOf(code);
    if (left === 0) { toast(`${cardName(code)} ครบแล้ว`); return; }
    const deck = currentDeck();
    const line = deck.purchases.find((p) => p.sellerId === sellerId && p.code === code);
    if (line) line.qty += left;
    else deck.purchases.push({ id: uid(), sellerId, code, qty: left, price: 0, pricing: 'lot' });
    save(); renderAll(); popBox(sellerId);
  }

  function openAssign(sellerId, code) {
    const seller = state.sellers.find((x) => x.id === sellerId);
    const left = leftOf(code);
    pending = { sellerId, code };
    setImage($('#dlg-img'), code);
    $('#dlg-title').textContent = `${cardName(code)} → ${seller.name}`;
    $('#dlg-sub').textContent = `${code} · ${left > 0 ? `ยังเหลือ ${left} ใบในเด็ค` : 'ครบแล้ว ยังบันทึกเพิ่มได้'}`;
    $('#dlg-qty').value = left > 0 ? left : 1;
    $('#dlg-pricing').value = 'each';
    $('#dlg-price').value = lastPrice(code);
    syncPricingLabel();
    $('#dlg-error').hidden = true;
    $('#dlg').showModal();
    $('#dlg-price').focus();
    $('#dlg-price').select();
  }

  function submitAssign(e) {
    e.preventDefault();
    const qty = parseNum($('#dlg-qty').value);
    const price = parseNum($('#dlg-price').value);
    const pricing = $('#dlg-pricing').value === 'lot' ? 'lot' : 'each';
    const err = $('#dlg-error');
    if (qty === null || !Number.isInteger(qty) || qty < 1) { err.textContent = 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1'; err.hidden = false; return; }
    if (price === null) { err.textContent = pricing === 'lot' ? 'ราคารวมต้องเป็นตัวเลขที่ไม่ติดลบ' : 'ราคาต่อใบต้องเป็นตัวเลขที่ไม่ติดลบ'; err.hidden = false; return; }
    const { sellerId } = pending;
    currentDeck().purchases.push({ id: uid(), sellerId, code: pending.code, qty, price, pricing });
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
      selectedCode = null;
      save(); renderAll();
    });
    $('#deck-new').addEventListener('click', () => {
      const d = newDeck(`เด็ค ${state.decks.length + 1}`);
      state.decks.push(d);
      state.currentDeckId = d.id;
      selectedCode = null;
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
      selectedCode = null;
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
        if (selectedCode === code) selectedCode = null;
        save(); renderAll();
        return;
      }
      if (narrow.matches) {
        selectedCode = selectedCode === code ? null : code;
        renderAll();
      } else {
        openPreview(code);
      }
    });
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
        const seller = state.sellers.find((x) => x.id === id);
        if (!confirm(`ลบคนขาย "${seller.name}" และการจัดซื้อจากคนนี้ทุกเด็ค?`)) return;
        state.sellers = state.sellers.filter((x) => x.id !== id);
        for (const d of state.decks) {
          d.purchases = d.purchases.filter((p) => p.sellerId !== id);
          if (d.sellerTotals) delete d.sellerTotals[id];
        }
        save(); renderAll();
        return;
      }
      if (t.closest('button, input, label')) return;
      if (selectedCode) {
        const code = selectedCode;
        selectedCode = null;
        assign(box.dataset.seller, code);
        renderAll();
        return;
      }
      const mini = t.closest('.mini');
      if (mini) openPreview(mini.dataset.code);
    });

    root.addEventListener('change', (e) => {
      const box = e.target.closest('.box');
      if (!box) return;
      const seller = state.sellers.find((x) => x.id === box.dataset.seller);
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
      state.sellers.push({ id: uid(), name: `คนขาย ${state.sellers.length + 1}`, shipping: 0 });
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
    $('#dlg-cancel').addEventListener('click', () => { pending = null; $('#dlg').close(); });
    // คลิกที่ใดก็ได้ในหน้าดูรูปใหญ่เพื่อปิด
    $('#preview').addEventListener('click', () => $('#preview').close());
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

  // ---------- export / import ----------

  function exportData() {
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
      state = { cards: {}, ...data };
      if (!state.decks.some((d) => d.id === state.currentDeckId)) state.currentDeckId = state.decks[0].id;
      selectedCode = null;
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
  narrow.addEventListener('change', () => { selectedCode = null; renderAll(); });
  renderAll();
  // ดึงชื่อ/รูปของการ์ดที่ยังไม่มีข้อมูล
  const codes = new Set(state.decks.flatMap((d) => d.items.map((i) => i.code)));
  codes.forEach((code) => fetchCardInfo(code));
})();
