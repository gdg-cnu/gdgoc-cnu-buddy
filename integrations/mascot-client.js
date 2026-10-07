'use strict';

// ===========================================================================
// 마스코트 전송 클라이언트 — 빌드/테스트 도구에서 상태를 보내는 공용 헬퍼
//   const m = require('./mascot-client');
//   m.building('vite')  → 마스코트 집중(빌드 중)
//   m.success('빌드 완료', '1.8s')  → 마스코트 기뻐함
//   m.fail('빌드 실패', 'TS error 3개')  → 마스코트 놀람(흔들림)
// 앱이 꺼져 있어도 조용히 무시(개발 흐름을 절대 막지 않음).
// ===========================================================================

const http = require('http');

const HOST = process.env.MASCOT_HOST || '127.0.0.1';
const PORT = Number(process.env.MASCOT_PORT) || 7842;
const TOKEN = process.env.MASCOT_TOKEN || '';
// MASCOT_DISABLE=1 이면 전송을 완전히 끔
const DISABLED = process.env.MASCOT_DISABLE === '1';

// 응답을 받으면 { status, body }, 보내지 못했으면 false 로 resolve 한다.
// 앱이 꺼져 있는 건 정상 상황이라 reject 하지 않는다 — 빌드를 멈추면 안 되니까.
function post(pathName, payload) {
  return new Promise((resolve) => {
    if (DISABLED) return resolve(false);
    const body = JSON.stringify(payload || {});
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: pathName,
        method: 'POST',
        timeout: 800,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(TOKEN ? { 'x-token': TOKEN } : {}),
        },
      },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (out += d));
        res.on('end', () => resolve({ status: res.statusCode, body: out }));
      }
    );
    // 앱이 안 떠 있으면 조용히 넘어감
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

// 지속 "집중" 상태로 전환 (ttl 없음 → baseState = working)
function state(name) {
  return post('/state', { state: name });
}
// 말풍선은 title 을 쓴 그대로 표시 — 이모지도 문구에 직접 넣는다
function building(label) {
  return post('/notify', {
    title: '🔨 빌드 드갑니다',
    message: label ? `${label} 컴파일 중…` : '컴파일 중…',
    level: 'info',
  }).then(() => state('working'));
}
function success(title, message) {
  // 지속 working 해제 → idle 로 되돌린 뒤 축하
  return state('idle').then(() =>
    post('/notify', { title: title || '빌드 완료', message: message || '', level: 'success' })
  );
}
function fail(title, message) {
  return state('idle').then(() =>
    post('/notify', { title: title || '빌드 실패', message: message || '', level: 'urgent' })
  );
}
function ready(title, message) {
  return post('/notify', { title: title || 'dev 서버 준비 완료', message: message || '', level: 'success' });
}
// Core Web Vitals 실측값 — { metrics: { LCP, INP, CLS, ... }, url }
// 좋고 나쁨의 판정과 표정 선택은 마스코트 앱이 한다
function vitals(payload) {
  return post('/vitals', payload || {});
}

// 알림을 보내고 나간다. 앱이 응답하지 않아도 graceMs 뒤에는 무조건 끝낸다.
function exitWhenSent(sending, code, graceMs = 2000) {
  let done = false;
  const bye = () => {
    if (done) return;
    done = true;
    process.exit(code);
  };
  Promise.resolve(sending).then(bye, bye);
  setTimeout(bye, graceMs).unref();
}

// disabled: 전송을 끈 상태인지 — 못 보낸 것과 안 보낸 것을 구분해야 하는 쪽에서 쓴다
module.exports = { post, state, building, success, fail, ready, vitals, exitWhenSent, disabled: DISABLED };
