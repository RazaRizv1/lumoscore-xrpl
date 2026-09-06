// Serves _tools/apikey.html on http://127.0.0.1:8099 — a DEV-ONLY helper for obtaining an
// xrpl.to API key.
//
// It needs a real http origin rather than file://, because GemWallet's content script posts to
// window.location.origin and a file:// page has none. Nothing here is part of the site: this file
// and apikey.html live in _tools/ and never reach dist/.
//
//   node _tools/apikey-server.js      then open http://127.0.0.1:8099
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, 'apikey.html');
const PORT = Number(process.argv[2] || 8099);

http.createServer((req, res) => {
  let html;
  try { html = fs.readFileSync(PAGE); } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('apikey.html missing');
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': html.length,
    'cache-control': 'no-store',
  });
  res.end(html);
}).listen(PORT, '127.0.0.1', () => {
  console.log('xrpl.to key helper: http://127.0.0.1:' + PORT);
  console.log('Unlock GemWallet in your browser, open that URL, and click the button.');
  console.log('Ctrl+C to stop.');
});
