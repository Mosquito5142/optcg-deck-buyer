// วาดรูป (JPEG) ของการ์ดที่ยังขาด (ไว้ส่งให้คนขายดูว่าต้องการใบไหนกี่ใบ)
(function (root) {
  'use strict';

  const FONT = '"Sarabun", "Leelawadee UI", "Noto Sans Thai", system-ui, sans-serif';
  const COLS = 5;
  const W = 200;
  const H = 280;
  const GAP = 18;
  const PAD = 36;
  const HEAD = 120;
  const CAP = 34;

  // โหลดรูปแบบ CORS ได้ก็ใช้ ถ้าไม่ได้ (เว็บต้นทางไม่อนุญาต) คืน null แล้ววาดกรอบชื่อแทน
  function loadImage(srcs) {
    return new Promise((resolve) => {
      const list = srcs.filter(Boolean);
      const next = () => {
        const src = list.shift();
        if (!src) { resolve(null); return; }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = next;
        img.src = src;
      };
      next();
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function ellipsize(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }

  // ตัดข้อความเป็นหลายบรรทัดตามความกว้าง (ใช้ในกรอบที่ไม่มีรูป)
  function wrap(ctx, text, max, lines) {
    const out = [];
    let line = '';
    for (const ch of text) {
      if (ctx.measureText(line + ch).width > max && line) { out.push(line); line = ch; } else line += ch;
    }
    if (line) out.push(line);
    if (out.length > lines) { out.length = lines; out[lines - 1] = ellipsize(ctx, out[lines - 1] + '…', max); }
    return out;
  }

  function badge(ctx, text, x, y, bg, fg, size) {
    ctx.font = `800 ${size}px ${FONT}`;
    const w = ctx.measureText(text).width + size * 0.9;
    const h = size * 1.5;
    ctx.fillStyle = bg;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + size * 0.45, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  // cards: [{ code, name, left, sources: [url...] }]
  async function render({ title, subtitle, cards }) {
    const cols = Math.min(COLS, Math.max(cards.length, 3));
    const rows = Math.ceil(cards.length / cols);
    const width = PAD * 2 + cols * W + (cols - 1) * GAP;
    const height = HEAD + PAD + rows * (H + CAP) + (rows - 1) * GAP;
    const canvas = document.createElement('canvas');
    const scale = 2; // คมบนจอมือถือ
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ef4a3c';
    ctx.fillRect(0, 0, width, 6);
    ctx.fillStyle = '#eef0f4';
    ctx.font = `800 30px ${FONT}`;
    ctx.fillText(ellipsize(ctx, title, width - PAD * 2), PAD, 58);
    ctx.fillStyle = '#8e95a5';
    ctx.font = `500 18px ${FONT}`;
    ctx.fillText(subtitle, PAD, 90);

    const images = await Promise.all(cards.map((c) => loadImage(c.sources)));
    cards.forEach((c, i) => {
      const x = PAD + (i % cols) * (W + GAP);
      const y = HEAD + Math.floor(i / cols) * (H + CAP + GAP);
      ctx.save();
      roundRect(ctx, x, y, W, H, 10);
      ctx.clip();
      if (images[i]) {
        ctx.drawImage(images[i], x, y, W, H);
      } else {
        const g = ctx.createLinearGradient(x, y, x + W, y + H);
        g.addColorStop(0, '#252a36');
        g.addColorStop(1, '#1d212b');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, W, H);
        ctx.fillStyle = '#eef0f4';
        ctx.font = `700 20px ${FONT}`;
        ctx.textAlign = 'center';
        const lines = wrap(ctx, c.name, W - 28, 3);
        lines.forEach((l, k) => ctx.fillText(l, x + W / 2, y + H / 2 - (lines.length - 1) * 13 + k * 26));
        ctx.fillStyle = '#8e95a5';
        ctx.font = `500 15px ui-monospace, Consolas, monospace`;
        ctx.fillText(c.code, x + W / 2, y + H / 2 + lines.length * 13 + 16);
        ctx.textAlign = 'left';
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth = 1;
      roundRect(ctx, x + .5, y + .5, W - 1, H - 1, 10);
      ctx.stroke();

      badge(ctx, `ขาด ${c.left}`, x + 8, y + 8, '#ef4a3c', '#ffffff', 20);
      ctx.fillStyle = '#eef0f4';
      ctx.font = `600 16px ${FONT}`;
      ctx.fillText(ellipsize(ctx, c.name, W - 4), x + 2, y + H + 22);
    });

    // JPEG: รูปการ์ดเป็นภาพถ่าย PNG จะใหญ่หลาย MB ส่งทางแชตช้า
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  }

  root.Shot = { render };
})(window);
