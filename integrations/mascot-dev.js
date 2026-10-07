#!/usr/bin/env node
'use strict';

// ===========================================================================
// mascot-dev — 아무 dev 서버 앞에 세우는 얇은 프록시
//
//   mascot-dev npm run dev                 ← 보통은 이걸로 충분
//   mascot-dev --port 3000 -- npm run dev  ← 포트를 직접 지정
//   mascot-dev --sidecar -- npm run dev    ← 옆 포트(7843)에 따로 세움
//
// 명령을 그대로 실행한 뒤, 그 서버가 내려주는 HTML 에만 측정 스크립트를 끼워
// 넣는다. 프로젝트 파일을 하나도 건드리지 않으므로 Next.js·webpack·CRA·Astro·
// 정적 서버까지 같은 방법으로 쓴다. 명령이 끝나면 프록시도 함께 사라진다.
//
// 기본 동작은 "늘 열던 포트를 프록시가 먼저 차지"다. 포트는 명령·설정·환경변수
// 에서 알아내고, 못 알아내면 옆 포트(7843)로 물러난다. 자리를 비켜주는 서버
// (Vite·Next·CRA·Nuxt)라면 브라우저는 평소 주소를 그대로 열면 된다.
// ===========================================================================

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const m = require('./mascot-client');

const MASCOT_HOST = process.env.MASCOT_HOST || '127.0.0.1';
const MASCOT_PORT = Number(process.env.MASCOT_PORT) || 7842;
const MASCOT_TOKEN = process.env.MASCOT_TOKEN || '';
const SCRIPT_URL =
  `http://${MASCOT_HOST}:${MASCOT_PORT}/vitals-client.js` +
  (MASCOT_TOKEN ? `?token=${encodeURIComponent(MASCOT_TOKEN)}` : '');

const SIDECAR_PORT = 7843; // 자리를 못 잡을 때 프록시가 설 자리
const WAIT_TIMEOUT_MS = 60000; // dev 서버가 뜨기를 기다리는 한계
const WAIT_RETRY_MS = 200;
const PORT_TRIES = 10; // 사이드카 포트가 쓰이는 중이면 뒤로 밀어본다
const EXIT_GRACE_MS = 2000; // 알림을 보내고 나갈 때까지 기다리는 시간
const MAX_WAITERS = 32; // 업스트림을 기다리는 요청 상한

// 흔한 도구의 기본 포트. 설정 파일의 port: N 이 있으면 그게 이긴다.
const DEFAULT_PORTS = [
  [/vite/, 5173],
  [/next|nuxt|react-scripts|remix/, 3000],
  [/astro/, 4321],
  [/webpack/, 8080],
];
const CONFIG_FILES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
  'astro.config.mjs',
  'astro.config.ts',
  'astro.config.js',
];

// ---------------------------------------------------------------------------
// 인자
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { port: 0, sidecar: false, label: '', cmd: [] };
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--sidecar') opts.sidecar = true;
    else if (a === '--label') opts.label = argv[++i];
    else break;
  }
  opts.cmd = argv.slice(i);
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (!opts.cmd.length) {
  console.error(`사용법: mascot-dev [--port <포트>] [--sidecar] <명령>

  mascot-dev npm run dev                  보통은 이걸로 충분 (포트를 알아서 잡음)
  mascot-dev --port 3000 -- npm run dev   포트를 직접 지정
  mascot-dev --sidecar -- npm run dev     옆 포트(${SIDECAR_PORT})에 따로 세움`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 포트 추측 — --port 가 없으면 명령·설정·환경변수에서 알아낸다
// ---------------------------------------------------------------------------
function read(file) {
  try {
    return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  } catch (_) {
    return '';
  }
}

// package.json 의 "dev" 같은 스크립트를 실제 명령으로 풀어낸다
function expandScript(cmd) {
  const joined = cmd.join(' ');
  const mRun = joined.match(/^(npm|yarn|pnpm|bun)(?:\s+run)?\s+(\S+)(.*)$/);
  if (!mRun) return joined;
  try {
    const pkg = JSON.parse(read('package.json') || '{}');
    const script = pkg.scripts && pkg.scripts[mRun[2]];
    if (script) return `${script}${mRun[3] || ''}`;
  } catch (_) {}
  return joined;
}

function guessPort(cmd) {
  if (opts.port) return opts.port;
  if (opts.sidecar) return 0;

  const text = expandScript(cmd);
  const fromFlag = text.match(/(?:^|\s)(?:--port|-p)\s+(\d+)\b/);
  if (fromFlag) return Number(fromFlag[1]);

  for (const name of CONFIG_FILES) {
    const hit = read(name).match(/\bport\s*:\s*(\d+)/);
    if (hit) return Number(hit[1]);
  }

  const fromEnv =
    Number(process.env.PORT) ||
    Number((read('.env.local') || read('.env')).match(/^\s*PORT\s*=\s*(\d+)\s*$/m)?.[1]) ||
    0;
  if (fromEnv) return fromEnv;

  const deps = (() => {
    try {
      const pkg = JSON.parse(read('package.json') || '{}');
      return { ...pkg.dependencies, ...pkg.devDependencies };
    } catch (_) {
      return {};
    }
  })();
  const hay = `${text} ${Object.keys(deps).join(' ')}`;
  for (const [re, port] of DEFAULT_PORTS) {
    if (re.test(hay)) return port;
  }
  return 0;
}

let intendedPort = guessPort(opts.cmd);
let takeover = intendedPort > 0;

// ---------------------------------------------------------------------------
// HTML 주입
// ---------------------------------------------------------------------------
const TAG = `<script src="${SCRIPT_URL}" defer></script>`;

const MAX_HOLD = 64 * 1024; // 넣을 자리를 찾느라 붙잡아 둘 수 있는 한계

// 넣을 자리를 찾는다. </head> 앞이 가장 좋고, 없으면 <body> 뒤라도 좋다.
function findSlot(text) {
  const head = text.match(/<\/head>/i);
  if (head) return head.index;
  const body = text.match(/<body[^>]*>/i);
  if (body) return body.index + body[0].length;
  return -1;
}

// head·body 조차 없는 조각이면 맨 앞에 붙인다
function inject(html) {
  const slot = findSlot(html);
  return slot >= 0 ? html.slice(0, slot) + TAG + html.slice(slot) : TAG + html;
}

// HTML 을 다 모은 뒤에 손대면 스트리밍 SSR(Next.js·Remix 등)이 끊기고, 그러면 정작
// 재려는 TTFB·FCP 가 나빠진다. 그래서 넣을 자리를 찾은 즉시 흘려보내고, 그 뒤로는
// 손대지 않고 그대로 통과시킨다. <head> 는 문서 맨 앞이라 붙잡는 양이 얼마 안 된다.
function pipeHtml(pres, cres) {
  let held = ''; // 아직 자리를 못 찾아 들고 있는 앞부분
  let flowing = false; // 자리를 정했으니 이제부터는 그대로 흘려보낸다

  pres.setEncoding('utf8'); // 글자가 조각 경계에서 쪼개지지 않게 맡긴다

  pres.on('data', (text) => {
    if (flowing) return void cres.write(text);

    held += text;
    if (held.includes('vitals-client.js')) {
      flowing = true; // 이미 붙어 있다
      cres.write(held);
      held = '';
      return;
    }

    const slot = findSlot(held);
    if (slot >= 0) {
      flowing = true;
      cres.write(held.slice(0, slot) + TAG + held.slice(slot));
      held = '';
    } else if (Buffer.byteLength(held) > MAX_HOLD) {
      flowing = true; // 자리를 못 찾겠다 — 붙잡고 있느니 손대지 않고 보낸다
      cres.write(held);
      held = '';
    }
  });

  // 문서가 짧아 아직 들고 있다면 이때 넣는다 (head·body 없는 조각도 여기서 처리)
  pres.on('end', () => cres.end(flowing ? undefined : inject(held)));
  pres.on('error', () => cres.destroy());
}

// ---------------------------------------------------------------------------
// dev 서버 포트 — 프록시가 먼저 서고 dev 서버가 나중에 뜨는 순서도 있어서,
// 아직 모르는 동안 들어온 요청은 붙잡아 두었다가 알게 되면 흘려보낸다.
// ---------------------------------------------------------------------------
let devPort = 0;
let proxyPort = 0;
let probing = false;
let waiters = [];

function setDevPort(port) {
  if (devPort || probing || !port) return;
  if (port === proxyPort) return; // 내 포트를 나에게 넘기면 끝없이 돈다
  probing = true;

  waitForPort(port).then((up) => {
    probing = false;
    if (!up) {
      console.error(`\n[mascot] dev 서버(${port})가 열리지 않아 성능 측정을 건너뜁니다.`);
      return;
    }
    devPort = port;
    waiters.splice(0).forEach((resolve) => resolve(port));
    if (takeover) announce();
    else startSidecar();
  });
}

function waitUpstream() {
  if (devPort) return Promise.resolve(devPort);
  if (waiters.length >= MAX_WAITERS) return Promise.resolve(0);
  return new Promise((resolve) => {
    waiters.push(resolve);
    setTimeout(() => {
      const i = waiters.indexOf(resolve);
      if (i >= 0) waiters.splice(i, 1);
      resolve(devPort);
    }, WAIT_TIMEOUT_MS);
  });
}

// ---------------------------------------------------------------------------
// 프록시
// ---------------------------------------------------------------------------
function forward(port, creq, cres) {
  const headers = { ...creq.headers, host: `127.0.0.1:${port}` };
  // 압축된 응답은 열어보지 않고는 손볼 수 없다 — 애초에 압축을 받지 않는다
  delete headers['accept-encoding'];

  const preq = http.request(
    { host: '127.0.0.1', port, method: creq.method, path: creq.url, headers },
    (pres) => {
      const type = pres.headers['content-type'] || '';
      // HTML 이 아니거나, 압축을 끄라고 했는데도 압축해 보냈다면 손대지 않는다
      if (!/text\/html/i.test(type) || pres.headers['content-encoding']) {
        cres.writeHead(pres.statusCode, pres.headers);
        return pres.pipe(cres);
      }
      const out = { ...pres.headers };
      // 길이가 달라지고 조각으로 나눠 보내므로 원본의 길이·전송 방식은 버린다
      delete out['content-length'];
      delete out['transfer-encoding'];
      cres.writeHead(pres.statusCode, out);
      pipeHtml(pres, cres);
    }
  );

  preq.on('error', (e) => {
    if (cres.headersSent) return cres.destroy();
    cres.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    cres.end(`dev 서버(${port})에 연결하지 못했습니다: ${e.message}`);
  });
  creq.pipe(preq);
}

// HMR 은 웹소켓을 쓴다 — 업그레이드부터는 바이트를 그대로 이어 붙인다
function tunnel(port, creq, csock, head) {
  const up = net.connect(port, '127.0.0.1', () => {
    up.write(`${creq.method} ${creq.url} HTTP/1.1\r\n`);
    for (let i = 0; i < creq.rawHeaders.length; i += 2) {
      up.write(`${creq.rawHeaders[i]}: ${creq.rawHeaders[i + 1]}\r\n`);
    }
    up.write('\r\n');
    if (head && head.length) up.write(head);
    up.pipe(csock);
    csock.pipe(up);
  });
  up.on('error', () => csock.destroy());
  csock.on('error', () => up.destroy());
}

function createProxy() {
  const server = http.createServer((creq, cres) => {
    waitUpstream().then((port) => {
      if (port) return forward(port, creq, cres);
      cres.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      cres.end('dev 서버가 아직 열리지 않았습니다.');
    });
  });

  server.on('upgrade', (creq, csock, head) => {
    waitUpstream().then((port) => (port ? tunnel(port, creq, csock, head) : csock.destroy()));
  });

  return server;
}

function listen(server, port, triesLeft) {
  return new Promise((resolve, reject) => {
    const onError = (e) => {
      if (e.code === 'EADDRINUSE' && triesLeft > 0) {
        server.removeListener('error', onError);
        return listen(server, port + 1, triesLeft - 1).then(resolve, reject);
      }
      reject(e);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve(port);
    });
  });
}

function waitForPort(port) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.once('error', () => {
        s.destroy();
        if (Date.now() > deadline) return resolve(false);
        setTimeout(tryOnce, WAIT_RETRY_MS);
      });
    };
    tryOnce();
  });
}

// ---------------------------------------------------------------------------
// 알림
// ---------------------------------------------------------------------------
function announce() {
  const url = `http://localhost:${proxyPort}`;
  if (takeover) {
    console.log(
      `\n  🤖 ${url} — 늘 열던 주소를 그대로 열면 됩니다\n` +
        `     (dev 서버는 옆 포트 ${devPort} 에서 돌고 있고, 프록시가 넘겨줍니다)\n`
    );
  } else {
    console.log(
      `\n  🤖 성능을 재려면 이 주소로 열어주세요 → ${url}\n` +
        `     http://localhost:${devPort} 로 열면 측정되지 않습니다\n` +
        `     늘 쓰던 주소를 그대로 열고 싶다면:\n` +
        `       mascot-dev --port ${devPort} -- ${label}\n`
    );
  }
  m.ready('⭐️ dev 서버 준비 완료~! ⭐️', `${url} 열림`);
}

let proxy = null;

async function startSidecar() {
  proxy = createProxy();
  try {
    proxyPort = await listen(proxy, SIDECAR_PORT, PORT_TRIES);
  } catch (e) {
    console.error(`\n[mascot] 프록시를 띄우지 못했습니다: ${e.message}`);
    proxy = null;
    return;
  }
  announce();
}

// ---------------------------------------------------------------------------
// 명령 실행
// ---------------------------------------------------------------------------
const label = opts.label || opts.cmd.join(' ');
let child = null;

// "http://localhost:5173" / IPv6 같은 첫 주소에서 포트를 얻는다
const URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\[::ffff:127\.0\.0\.1\])(?::(\d+))?/i;

function startChild() {
  child = spawn(opts.cmd[0], opts.cmd.slice(1), {
    // 출력에서 주소를 읽어내야 해서 넘겨받아 그대로 다시 내보낸다.
    // TTY 가 아니게 되므로 색이 꺼지지 않도록 알려둔다.
    stdio: ['inherit', 'pipe', 'pipe'],
    // Windows 에서 npm/yarn 은 .cmd 라 shell 이 필요하다
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR || '1',
      // 자리를 비켜달라는 뜻 — PORT 를 보는 서버는 여기로 곧장 간다.
      // 보지 않는 서버는 원래 포트가 막힌 걸 알고 스스로 옆으로 옮긴다.
      ...(takeover ? { PORT: String(intendedPort + 1) } : null),
    },
  });

  // URL 로그를 안 찍는 서버도 있으니, takeover 면 옆 포트를 미리 기다려 본다
  if (takeover) setDevPort(intendedPort + 1);

  const relay = (from, to) => {
    from.on('data', (buf) => {
      to.write(buf);
      if (!devPort) setDevPort(Number((buf.toString('utf8').match(URL_RE) || [])[1] || 0));
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);

  child.on('error', (e) => {
    exitWhenSent(m.fail('실행 실패...', String(e.message).slice(0, 120)), 1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      if (proxy) proxy.close();
      process.kill(process.pid, signal);
      return;
    }
    if (takeover && !devPort) {
      console.error(
        `\n[mascot] dev 서버가 프록시에게 자리를 비켜주지 않았습니다 (포트 ${intendedPort}).\n` +
          `         포트가 고정된 서버라면 옆 포트로 세우세요:\n` +
          `           mascot-dev --sidecar -- ${label}`
      );
    }
    // dev 서버는 Ctrl+C 로 끝내는 것이 정상이라 0 이 아니어도 호들갑 떨지 않는다
    const done = code === 0 ? Promise.resolve() : m.state('idle');
    exitWhenSent(done, code == null ? 0 : code);
  });
}

async function main() {
  if (takeover) {
    proxy = createProxy();
    try {
      proxyPort = await listen(proxy, intendedPort, 0);
    } catch (e) {
      // 자동 추측이 틀렸거나 이미 다른 게 쓰고 있으면 옆 포트로 물러난다.
      // --port 로 직접 지정한 경우만 실패로 끝낸다.
      if (opts.port) {
        console.error(
          `\n[mascot] ${intendedPort} 를 쓸 수 없습니다: ${e.message}\n` +
            `         이미 무언가 열려 있다면 그것을 먼저 끄거나 --sidecar 로 실행하세요.`
        );
        process.exit(1);
      }
      console.error(
        `\n[mascot] ${intendedPort} 가 이미 쓰이는 중이라 옆 포트(${SIDECAR_PORT})로 물러납니다.\n` +
          `         늘 쓰던 주소를 그대로 쓰려면 그 프로세스를 먼저 끄세요.`
      );
      takeover = false;
      intendedPort = 0;
      proxy = null;
    }
  } else if (!opts.sidecar) {
    console.log(
      `\n[mascot] 포트를 알아내지 못해 옆 포트(${SIDECAR_PORT})에 세웁니다.\n` +
        `         늘 쓰던 주소를 그대로 열려면: mascot-dev --port <포트> -- ${label}`
    );
  }
  startChild();
}

main();

// ---------------------------------------------------------------------------
// 끝내기
// ---------------------------------------------------------------------------
function forwardSignal(signal) {
  if (child && !child.killed) child.kill(signal);
}
process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

// 알림은 보내고 나가야 한다 — 다만 앱이 느려도 종료가 붙잡히지 않게 시간을 끊는다
function exitWhenSent(sending, code) {
  if (proxy) proxy.close();
  m.exitWhenSent(sending, code, EXIT_GRACE_MS);
}
