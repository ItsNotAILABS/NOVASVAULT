const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assets = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'] };
http.createServer(async (req, res) => {
  if (!['127.0.0.1:4317', 'localhost:4317'].includes(req.headers.host)) { res.writeHead(403); return res.end(); }
  const asset = assets[req.url];
  if (req.method !== 'GET' || !asset) { res.writeHead(404); return res.end(); }
  try { const data = await fs.readFile(path.join(__dirname, '../forge', asset[0])); res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); res.end(data); } catch { res.writeHead(503); res.end('Build the forge with npm run forge:build first.'); }
}).listen(4317, '127.0.0.1', () => console.log('VAUL Forge: http://127.0.0.1:4317 (open in your wallet-enabled browser)'));
