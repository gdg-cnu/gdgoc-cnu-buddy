'use strict';

const http = require('http');
const fs = require('fs');
const { URL } = require('url');

// Windows 의 curl(Git Bash 포함)은 명령줄 한글을 UTF-8 이 아니라 CP949 바이트로 보낸다.
// UTF-8 로 읽히지 않으면 CP949 로 다시 읽는다. 이모지는 curl 이 보내기 전에 '?' 로
// 바꿔 버려서 되살릴 수 없다. (CP949 가 아닌 다른 언어판 Windows 는 여전히 깨진다)
function decodeBody(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (_) {
    return new TextDecoder('euc-kr').decode(buf); // WHATWG 의 euc-kr 은 CP949 전체를 읽는다
  }
}

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

    // 조각을 바이트로 모았다가 한 번에 푼다 — 문자열로 이어 붙이면 경계에 걸친 한글이 깨진다
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      chunks.push(c);
      size += c.length;
      if (size > 1e6) {
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
      const body = decodeBody(Buffer.concat(chunks));
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
