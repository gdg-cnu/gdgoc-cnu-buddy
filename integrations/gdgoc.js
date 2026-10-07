#!/usr/bin/env node
'use strict';

// ===========================================================================
// gdgoc — 빌드 감시 / 성능 측정을 한 줄로 고르는 디스패처
//
//   gdgoc npm run build  → mascot-watch (빌드·테스트 반응)
//   gdgoc npm run dev    → mascot-dev   (dev 서버 + Web Vitals)
//   gdgoc --watch <명령> → 강제로 빌드 감시
//   gdgoc --dev <명령>   → 강제로 성능 측정
//
// 앱 실행은: 클론한 폴더에서 npm start
// ===========================================================================

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

if (!args.length || args[0] === '-h' || args[0] === '--help') {
  console.log(`사용법:
  gdgoc npm run build     빌드/테스트 반응
  gdgoc npm run dev       성능 측정 (dev 서버)
  gdgoc --watch <명령>    강제로 빌드 감시
  gdgoc --dev <명령>      강제로 성능 측정

앱 실행은: 클론한 폴더에서 npm start`);
  process.exit(args.length ? 0 : 1);
}

let mode = null; // 'watch' | 'dev'
if (args[0] === '--watch') {
  mode = 'watch';
  args.shift();
} else if (args[0] === '--dev') {
  mode = 'dev';
  args.shift();
}

if (!args.length) {
  console.error('명령을 입력해 주세요. 예: gdgoc npm run build');
  process.exit(1);
}

function readPkg() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  } catch (_) {
    return {};
  }
}

// package.json 의 "dev" 같은 스크립트를 실제 명령으로 풀어낸다 (mascot-dev 와 동일)
function expandScript(cmd) {
  const joined = cmd.join(' ');
  const mRun = joined.match(/^(npm|yarn|pnpm|bun)(?:\s+run)?\s+(\S+)(.*)$/);
  if (!mRun) return joined;
  try {
    const pkg = readPkg();
    const script = pkg.scripts && pkg.scripts[mRun[2]];
    if (script) return `${script}${mRun[3] || ''}`;
  } catch (_) {}
  return joined;
}

function isDevCommand(cmd) {
  if (mode === 'dev') return true;
  if (mode === 'watch') return false;

  const joined = cmd.join(' ');
  // 스크립트 이름이 정확히 dev/start/serve/preview 이거나, :dev 같은 접미만 허용
  // (start:prod / start:production 은 빌드 감시로 보낸다)
  const runName = joined.match(/^(npm|yarn|pnpm|bun)(?:\s+run)?\s+(\S+)/);
  if (runName) {
    const name = runName[2];
    if (/^(dev|serve|preview)(:|$)/i.test(name)) return true;
    if (/^start$/i.test(name)) return true;
    if (/^start:dev$/i.test(name)) return true;
  }

  const text = expandScript(cmd);
  if (/\bstart:(prod|production|release)\b/i.test(text)) return false;
  if (/(?:^|[\s:])(dev|serve|preview)(?:\s|$)/i.test(text)) return true;
  if (/(?:^|[\s])start(?:\s|$)/i.test(text)) return true;
  if (
    /^\s*(npx\s+)?(vite|next|nuxt|astro|remix|webpack(\s+serve)?|react-scripts\s+start)\b/i.test(text) &&
    !/\bbuild\b/i.test(text)
  ) {
    return true;
  }
  return false;
}

const useDev = isDevCommand(args);
const target = useDev ? 'mascot-dev.js' : 'mascot-watch.js';
const targetPath = path.join(__dirname, target);

// mascot-dev / mascot-watch 는 로드 시점에 process.argv 를 읽으므로 먼저 맞춘다
process.argv = [process.argv[0], targetPath, ...args];
require(path.join(__dirname, target));
