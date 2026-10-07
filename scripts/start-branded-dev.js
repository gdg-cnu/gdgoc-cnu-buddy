#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const BRAND = require('../shared/brand');

const ROOT = path.resolve(__dirname, '..');
const APP_NAME = BRAND.NAME; // Dock·메뉴 막대에 보이는 이름
const BUNDLE_ID = 'org.gdgoc-cnu.buddy';
const HELPER_BUNDLE_ID = `${BUNDLE_ID}.helper`;
const OUT_DIR = path.join(ROOT, 'out');
// .app 경로에는 ASCII 이름을 쓴다 (표시 이름은 CFBundleDisplayName = APP_NAME)
const BRANDED_APP = path.join(OUT_DIR, 'GDGoC-Buddy.app');
const ICON_SRC = path.join(ROOT, 'assets', 'icon.icns');
const PORT = process.env.MASCOT_PORT || 7842;

// 이 값이 켜져 있으면 Electron 이 순수 Node 로 떠서 app·ipcMain 이 undefined 가 되고
// 앱은 TypeError 만 남기고 죽는다 — 일부 터미널·툴링이 켜두므로 물려주기 전에 지운다.
delete process.env.ELECTRON_RUN_AS_NODE;

function runQuiet(command, args) {
  return spawnSync(command, args, { stdio: 'ignore' });
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} 실패`);
  }
}

function patchPlist(plistPath, key, value) {
  const result = runQuiet('/usr/bin/plutil', ['-replace', key, '-string', value, plistPath]);
  if (result.status !== 0) {
    throw new Error(`Info.plist 업데이트 실패: ${key}`);
  }
}

function sourceElectronApp() {
  const electronExecutable = require('electron');
  return path.resolve(path.dirname(electronExecutable), '..', '..');
}

function patchHelperPlists(contentsDir) {
  const frameworksDir = path.join(contentsDir, 'Frameworks');
  for (const helper of [
    'Electron Helper.app',
    'Electron Helper (GPU).app',
    'Electron Helper (Plugin).app',
    'Electron Helper (Renderer).app',
  ]) {
    const plistPath = path.join(frameworksDir, helper, 'Contents', 'Info.plist');
    if (fs.existsSync(plistPath)) {
      patchPlist(plistPath, 'CFBundleIdentifier', HELPER_BUNDLE_ID);
    }
  }
}

function ensureBrandedApp() {
  if (process.platform !== 'darwin') return null;
  if (!fs.existsSync(ICON_SRC)) {
    throw new Error(`앱 아이콘을 찾을 수 없습니다: ${ICON_SRC}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(BRANDED_APP)) {
    run('/usr/bin/ditto', ['--rsrc', '--extattr', sourceElectronApp(), BRANDED_APP]);
  }

  const contentsDir = path.join(BRANDED_APP, 'Contents');
  const resourcesDir = path.join(contentsDir, 'Resources');
  const plistPath = path.join(contentsDir, 'Info.plist');

  fs.copyFileSync(ICON_SRC, path.join(resourcesDir, 'gdgoc.icns'));

  patchPlist(plistPath, 'CFBundleDisplayName', APP_NAME);
  patchPlist(plistPath, 'CFBundleName', APP_NAME);
  patchPlist(plistPath, 'CFBundleIconFile', 'gdgoc.icns');
  patchPlist(plistPath, 'CFBundleIdentifier', BUNDLE_ID);
  patchHelperPlists(contentsDir);

  runQuiet('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', BRANDED_APP]);
  runQuiet('/usr/bin/touch', [BRANDED_APP]);
  runQuiet(
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    ['-f', BRANDED_APP]
  );

  return BRANDED_APP;
}

// 번들 준비·실행은 아이콘·ditto·plutil·codesign 에 기대는 편의 기능이라 환경에 따라
// 실패할 수 있다 — 그럴 땐 브랜딩 없이 Electron 으로 직접 띄우고 실행은 막지 않는다.
let brandedApp = null;
try {
  brandedApp = ensureBrandedApp();
} catch (e) {
  console.warn(`[mascot] 브랜딩된 앱 번들 준비를 건너뜁니다: ${e.message}`);
}

if (brandedApp) {
  // --max-time 없이 물으면 포트만 열려 있고 응답이 없는 상대에게 무한정 매달려
  // 아무 출력도 없이 실행이 멈춘다
  const health = spawnSync(
    'curl',
    ['-fsS', '--connect-timeout', '1', '--max-time', '2', `http://127.0.0.1:${PORT}/health`],
    { stdio: 'ignore' }
  );
  if (health.status === 0) {
    console.log(`${APP_NAME} 앱이 이미 실행 중이에요 (port ${PORT}).`);
    process.exit(0);
  }

  try {
    run('/usr/bin/open', ['-n', brandedApp, '--args', ROOT, ...process.argv.slice(2)]);
    console.log(`${APP_NAME} 앱을 실행했어요.`);
    process.exit(0);
  } catch (e) {
    console.warn(`[mascot] 앱 번들 실행 실패 — Electron 으로 직접 띄웁니다: ${e.message}`);
  }
}

const child = spawn(require('electron'), [ROOT, ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: 'inherit',
});

function forward(signal) {
  if (!child.killed) child.kill(signal);
}

process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
