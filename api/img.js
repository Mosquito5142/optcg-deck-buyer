// Vercel serverless function: GET /api/img?code=OP01-016 = รูปการ์ดจาก optcgapi (โดเมนเดียวกับเว็บ ใช้วาดภาพส่งออกได้)
'use strict';

const { handleImage } = require('./_image.js');

module.exports = async (req, res) => {
  const query = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const out = await handleImage({ query });
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  if (out.body) res.status(out.status).send(out.body);
  else res.status(out.status).end();
};
