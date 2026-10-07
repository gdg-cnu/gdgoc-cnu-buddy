'use strict';

const http = require('http');
const fs = require('fs');
const { URL } = require('url');

function startWebhookServer({
  port,
  token,
  getDnd,
  getVersion,
  handleEvent,
  handleVitals,
  vitalsClientPath,
  onListenError,
}) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://localhost:${port}`);

    if (req.method === 'GET' && url.pathname === '/vitals-client.js') {
      fs.readFile(vitalsClientPath, (err, buf) => {
        if (err) {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(buf);
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, dnd: getDnd(), version: getVersion() }));
    }

    if (token) {
      const tok = req.headers['x-token'] || url.searchParams.get('token');
      if (tok !== token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      }
    }

    if (req.method !== 'POST') {
      res.writeHead(404);
      return res.end();
    }

    let body = '';
    let tooLarge = false;
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) {
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'payload too large' }));
        }
        return;
      }
      let data = {};
      try {
        data = body ? JSON.parse(body) : {};
      } catch (_) {
        for (const [k, v] of url.searchParams) data[k] = v;
      }

      if (url.pathname === '/notify') {
        if (getDnd()) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, suppressed: 'dnd' }));
        }
        handleEvent('notify', data);
      } else if (url.pathname === '/activity') {
        handleEvent('activity', data);
      } else if (url.pathname === '/state') {
        handleEvent('state', data);
      } else if (url.pathname === '/vitals') {
        const result = handleVitals(data);
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'unknown endpoint' }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  server.on('error', (e) => {
    console.error('[server] 오류:', e.message);
    if (typeof onListenError === 'function') onListenError(e);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[server] http://127.0.0.1:${port} 대기중`);
  });
  return server;
}

module.exports = { startWebhookServer };
