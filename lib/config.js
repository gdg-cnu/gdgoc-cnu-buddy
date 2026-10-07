'use strict';

const path = require('path');
const fs = require('fs');
const { app, nativeImage } = require('electron');
const TIME = require('../shared/time');
const BRAND = require('../shared/brand');

const ROOT = path.join(__dirname, '..');

const DEFAULT_CONFIG = {
  port: 7842, // 웹훅 HTTP 서버 포트
  token: '', // 설정 시 웹훅 요청에 x-token 또는 ?token= 필요
  width: 315,
  height: 260,
  margin: 24,
  corner: 'bottom-right',
  idleSleepMs: 5 * TIME.MIN, // 0 이면 잠들지 않는다. 트레이 "잠드는 시간"에서 고른 값이 우선
  guideTitle: '학기 안내',
  guideSubtitle: '', // 비우면 화면마다 맞는 부제(학기 중·종강일·방학 중)
  guideWidth: 320,
  guideHeight: 500,
};

const APP_ICON_PATH = path.join(ROOT, 'assets', 'icon.png');
// 검정 실루엣은 macOS 메뉴바 템플릿 전용 — Windows 작업표시줄에서는 안 보여서 컬러를 쓴다
const TRAY_ICON_PATH = path.join(
  ROOT,
  'assets',
  process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'
);

function readJsonConfig(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error('[config] 읽기 실패:', filePath, e.message);
  }
  return null;
}

function loadConfig() {
  // 1) 패키지 폴더 config.json  2) 실행 cwd config.json  3) 환경변수
  // npm 설치만 한 프로젝트에서는 cwd 설정이 먹히도록 cwd 를 나중에 덮어쓴다.
  let cfg = { ...DEFAULT_CONFIG };
  const fromPkg = readJsonConfig(path.join(ROOT, 'config.json'));
  if (fromPkg) Object.assign(cfg, fromPkg);
  try {
    const cwd = process.cwd();
    if (path.resolve(cwd) !== path.resolve(ROOT)) {
      const fromCwd = readJsonConfig(path.join(cwd, 'config.json'));
      if (fromCwd) Object.assign(cfg, fromCwd);
    }
  } catch (_) {}

  if (process.env.MASCOT_PORT) {
    const p = Number(process.env.MASCOT_PORT);
    if (Number.isFinite(p) && p > 0) cfg.port = p;
  }
  if (process.env.MASCOT_TOKEN != null && process.env.MASCOT_TOKEN !== '') {
    cfg.token = process.env.MASCOT_TOKEN;
  }
  return cfg;
}

function appIcon() {
  const img = nativeImage.createFromPath(APP_ICON_PATH);
  return img.isEmpty() ? undefined : img;
}

function applyAppBranding() {
  app.setName(BRAND.NAME);
  // Windows 알림 위쪽에 앱 이름으로 보인다 — 안 정하면 "electron.app.Electron"
  if (process.platform === 'win32') app.setAppUserModelId(BRAND.NAME);
  if (process.platform !== 'darwin' || !app.dock) return;
  const icon = appIcon();
  if (icon) app.dock.setIcon(icon);
}

module.exports = {
  ROOT,
  DEFAULT_CONFIG,
  APP_ICON_PATH,
  TRAY_ICON_PATH,
  loadConfig,
  appIcon,
  applyAppBranding,
};
