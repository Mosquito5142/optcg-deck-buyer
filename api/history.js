// Vercel serverless function: GET = รายการประวัติ, GET ?id=N = ข้อมูลชุดนั้น (ไว้กู้คืน)
'use strict';

const { handleHistory } = require('./_core.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const query = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const out = await handleHistory({ method: req.method, query }, process.env);
  res.status(out.status).json(out.body);
};
