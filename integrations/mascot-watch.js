#!/usr/bin/env node
'use strict';

// ===========================================================================
// mascot-watch — 아무 명령이나 감싸서 결과를 마스코트에게 알려주는 래퍼
//
//   npx mascot-watch npm run build
//   npx mascot-watch -- vitest run
//   npx mascot-watch --label "타입체크" tsc --noEmit
//
// 시작 → 마스코트 집중(빌드 중) · 성공(exit 0) → 기뻐함 · 실패 → 놀람(흔들림)
// 명령의 stdout/stderr 는 그대로 통과시키고, 종료 코드도 그대로 전달해요.
// 프레임워크에 무관하게 build·test·lint·tsc 무엇이든 감쌀 수 있어요.
// ===========================================================================

const { spawn } = require('child_process');
const m = require('./mascot-client');

const argv = process.argv.slice(2);

// --label "이름" 옵션 파싱, `--` 구분자 지원
let label = null;
const cmd = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if ((a === '--label' || a === '-l') && cmd.length === 0) {
    label = argv[++i];
  } else if (a === '--' && cmd.length === 0) {
    // 이후는 전부 실행할 명령
    cmd.push(...argv.slice(i + 1));
    break;
  } else {
    cmd.push(a);
  }
}

if (cmd.length === 0) {
  console.error('사용법: mascot-watch [--label 이름] <명령> [인자...]');
  console.error('예:    mascot-watch npm run build');
  process.exit(2);
}

const name = label || cmd.join(' ');
const startedAt = Date.now();

function secs() {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

// 시작 알림 → 집중 상태
m.building(name);

// 알림이 나가기 전에 프로세스가 끝나면 이 도구는 존재 이유를 잃는다. success/fail 은
// 상태 전환과 알림을 연달아 보내므로 왕복이 두 번이라 짧은 여유로는 모자란다.
// 그렇다고 마스코트가 응답하지 않을 때 빌드 스크립트를 붙잡아 둘 수도 없어서,
// 전송이 끝나거나 이 시간이 지나거나 먼저 오는 쪽을 따른다.
const EXIT_GRACE_MS = 2000;

const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' });

child.on('error', (err) => {
  console.error(`[mascot-watch] 실행 실패: ${err.message}`);
  m.exitWhenSent(m.fail('실행 Fail...', `${cmd[0]}: ${err.message}`), 1, EXIT_GRACE_MS);
});

child.on('exit', (code, signal) => {
  const dur = secs();
  const sending =
    code === 0
      ? m.success('⭐️ 야호~성공~🎵⭐️', `${name} · ${dur}`)
      : m.fail('작업 Fail...', `${name} · 종료코드 ${code != null ? code : signal} · ${dur}`);
  m.exitWhenSent(sending, code == null ? 1 : code, EXIT_GRACE_MS);
});

// Ctrl+C 등은 자식에게 전달
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => child.kill(sig));
});
