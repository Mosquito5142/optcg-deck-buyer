// Vercel serverless function: GET = อ่านข้อมูลที่ซิงก์ไว้, PUT = เขียนทับ (ต้องมี header x-sync-key)
'use strict';

const { handleSync } = require('./_core.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = null; }
  }
  const out = await handleSync({ method: req.method, headers: req.headers, body }, process.env);
  res.status(out.status).json(out.body);
};
