#!/usr/bin/env node
'use strict';

// 웹훅 테스트 전송기
//   node scripts/send.js notify "제목" "메시지" [info|success|warn|urgent]
//   node scripts/send.js activity typing
//   node scripts/send.js state sleeping
//
// 전송은 integrations/mascot-client 에 맡긴다 — MASCOT_HOST·MASCOT_DISABLE·타임아웃을
// 그대로 따라가고, 앱과 말을 섞는 방법이 한 군데에만 있게 된다.

const { post, disabled } = require('../integrations/mascot-client');
const BRAND = require('../shared/brand');

const [, , kind, a, b, c] = process.argv;

let pathName;
let payload;

if (kind === 'activity') {
  pathName = '/activity';
  payload = { state: a || 'working', ttl: 4000 };
} else if (kind === 'state') {
  pathName = '/state';
  payload = { state: a || 'happy', ttl: 3000 };
} else {
  pathName = '/notify';
  payload = {
    title: a || '테스트 알림',
    message: b || `${BRAND.NAME} 웹훅이 정상 동작합니다.`,
    level: c || 'info',
  };
}

if (disabled) {
  // 일부러 꺼둔 것은 실패가 아니다
  console.log('MASCOT_DISABLE=1 — 전송하지 않았습니다.');
  process.exit(0);
}

post(pathName, payload).then((res) => {
  // 훅(git·Claude Code)에서 부르는 스크립트라 실패를 종료 코드로도 알린다
  if (!res) {
    console.error('전송 실패 — 앱이 실행 중인지 확인하세요.');
    process.exitCode = 1;
    return;
  }
  console.log(`[${res.status}] ${res.body}`);
  if (res.status >= 400) process.exitCode = 1;
});
