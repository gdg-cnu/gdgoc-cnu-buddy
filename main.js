'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  globalShortcut,
  nativeImage,
  Notification,
  powerMonitor,
  shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const TIME = require('./shared/time'); // 기다리는 시간·날짜 계산은 렌더러와 같은 값을 쓴다
const BRAND = require('./shared/brand');
const {
  ROOT,
  loadConfig,
  appIcon,
  applyAppBranding,
  TRAY_ICON_PATH,
} = require('./lib/config');
const { loadAnims } = require('./lib/anims');
const { createVitalsHandler } = require('./lib/vitals');
const { startWebhookServer } = require('./lib/webhook-server');

// 트레이에 며칠씩 상주하는 앱이라 예외 하나로 통째로 죽으면 사용자는 이유도 모르고
// 마스코트를 잃는다. 기록만 남기고 버틴다 — Node 는 처리되지 않은 rejection 도
// 프로세스를 종료시키므로 둘 다 잡는다.
process.on('uncaughtException', (e) => {
  console.error('[fatal] 처리되지 않은 예외:', (e && e.stack) || e);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] 처리되지 않은 rejection:', (reason && reason.stack) || reason);
});

const CONFIG = loadConfig();

// 두 번째 실행은 웹훅 포트를 못 잡고 "마스코트만 있고 반응 없음"이 된다 — 한 인스턴스만 살린다.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log(`${BRAND.NAME} 앱이 이미 실행 중이에요.`);
  app.quit();
}

let win = null;
let guideWin = null;
let tray = null;
let server = null;
let dnd = false;           // Do Not Disturb
let sleepTimer = null;
let asleep = false;        // 자는 중이면 산책하지 않는다
let helpWin = null;
const scheduledTimers = [];
const activeNotifications = new Set();

// 코딩 중 걷기(반대 모서리로 이동) 상태
let mover = null;
let walkTarget = null;      // { x, y } 목표 위치
let walkGoal = null;        // 'away'(반대 모서리) | 'home'(제자리)
let lastDir = -1;           // 바라보는 방향(-1 왼쪽, +1 오른쪽)
let workingUntil = 0;       // 이 시각까지 코딩중으로 간주
let returnTimer = null;
const WALK_SPEED = 4;       // 틱당 이동 px

// ---------------------------------------------------------------------------
// 창 위치 계산
// ---------------------------------------------------------------------------
function cornerPosition() {
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea; // 메뉴바/독 제외 영역
  const { width: w, height: h, margin, corner } = CONFIG;
  let x = wa.x + wa.width - w - margin;
  let y = wa.y + wa.height - h - margin;
  if (corner.includes('left')) x = wa.x + margin;
  if (corner.includes('top')) y = wa.y + margin;
  return { x: Math.round(x), y: Math.round(y) };
}

// setPosition은 정수만 받는다 — 디스플레이 절전/해상도 전환 순간 workArea에서
// NaN이 흘러들면 메인 프로세스가 통째로 죽으므로, 모든 창 이동은 여기로 거친다.
// 크기도 함께 고정해서 넘긴다 — Windows 배율(예: 175%)에서는 투명·고정 크기 창에
// setPosition 을 부를 때마다 반올림 오차로 창이 몇 px씩 커져, 걷다 보면 화면 밖으로 밀려난다.
function safeSetPosition(w, x, y) {
  if (!w || w.isDestroyed()) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  w.setBounds({ x: Math.round(x), y: Math.round(y), ...fixedSize(w) });
}
function fixedSize(w) {
  if (w === guideWin) return { width: CONFIG.guideWidth, height: CONFIG.guideHeight };
  if (w === helpWin) return { width: HELP_WIDTH, height: HELP_HEIGHT };
  return { width: CONFIG.width, height: CONFIG.height };
}

// 끌다가 경계에 막혔을 때, 커서가 밖으로 나간 거리를 이만큼까지만 기억한다. 한없이
// 세면 멀리 끌었다 돌아올 때 한참 헛돌고, 아예 세지 않으면 되돌아오는 순간 창이
// 커서에 달라붙어 잡은 지점이 어긋난다.
const DRAG_SLACK = 120;

// 창이 통째로 보이도록 좌표를 화면 안쪽으로 밀어넣는다.
// slack 을 주면 그만큼은 경계 밖을 허용한다 (드래그 의도를 기억할 때 쓴다)
function clampedToWorkArea(x, y, w, h, slack = 0) {
  const wa = screen.getDisplayNearestPoint({ x, y }).workArea;
  return {
    x: Math.max(wa.x - slack, Math.min(x, wa.x + wa.width - w + slack)),
    y: Math.max(wa.y - slack, Math.min(y, wa.y + wa.height - h + slack)),
  };
}

// 모니터를 빼거나 해상도가 바뀌면 창이 보이지 않는 좌표에 남는다 — 커서가 닿을 수
// 있는 영역으로 되돌린다. 그러지 않으면 되찾을 방법이 없다.
function clampWindowToScreen(w) {
  if (!w || w.isDestroyed()) return;
  const [x, y] = w.getPosition();
  const [ww, wh] = w.getSize();
  const p = clampedToWorkArea(x, y, ww, wh);
  if (p.x !== x || p.y !== y) safeSetPosition(w, p.x, p.y);
}

// 마스코트·안내·사용 안내 창이 모두 같은 브리지를 쓴다
const WEB_PREFS = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
};

function createWindow() {
  const { x, y } = cornerPosition();
  win = new BrowserWindow({
    width: CONFIG.width,
    height: CONFIG.height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    focusable: true,
    icon: appIcon(),
    webPreferences: WEB_PREFS,
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 기본은 클릭 통과 — 렌더러가 캐릭터/말풍선 위에 커서가 올라오면 해제한다.
  // forward: true 로 mousemove 는 계속 렌더러에 전달되어 hover 감지가 가능.
  win.setIgnoreMouseEvents(true, { forward: true });

  win.on('closed', () => {
    win = null;
  });
}

// ---------------------------------------------------------------------------
// 숨긴 창 정리
// 창을 숨겨도 렌더러 프로세스는 통째로 남아 60MB 남짓을 계속 붙잡는다. 안내·사용
// 안내 창은 어쩌다 한 번 여는 것이라, 한동안 닫혀 있으면 버리고 다음에 다시 만든다.
// ---------------------------------------------------------------------------
// show/hide 이벤트는 showInactive()·hide() 로 여닫을 때 오지 않아 믿을 수 없다.
// 값이 정확한 isVisible() 을 주기적으로 들여다본다.
const hiddenSince = new Map();
let hiddenSweeper = null;

function sweepHiddenWindows() {
  for (const w of [guideWin, helpWin]) {
    if (!w || w.isDestroyed()) continue;
    if (w.isVisible()) {
      hiddenSince.delete(w);
      continue;
    }
    const since = hiddenSince.get(w);
    if (since == null) {
      hiddenSince.set(w, Date.now());
    } else if (Date.now() - since >= TIME.HIDDEN_DESTROY_MS) {
      hiddenSince.delete(w);
      w.destroy(); // 참조는 'closed' 에서 비운다
    }
  }
}

// ---------------------------------------------------------------------------
// 안내 패널 창
// ---------------------------------------------------------------------------
function createGuideWindow() {
  guideWin = new BrowserWindow({
    width: CONFIG.guideWidth,
    height: CONFIG.guideHeight,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    icon: appIcon(),
    webPreferences: WEB_PREFS,
  });
  guideWin.setAlwaysOnTop(true, 'screen-saver');
  guideWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  guideWin.loadFile(path.join(__dirname, 'renderer', 'guide.html'));

  // 창은 지웠다 다시 만들 수 있다 — 핸들러는 모듈 변수 대신 자기 창을 붙잡는다
  const w = guideWin;

  // 닫기 대신 숨김 (앱은 계속 상주)
  w.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      w.hide();
    }
  });

  // 드래그는 guide:drag 가 처리한다 — 그 밖의 경로로(OS 가 옮겼다든지) 창이 움직였다면
  // 화면 안에 남아 있는지만 확인한다
  const onMoved = () => {
    if (w.isDestroyed()) return;
    const [x, y] = w.getPosition();
    if (guideAutoPos && x === guideAutoPos.x && y === guideAutoPos.y) return;
    keepGuideOnScreen();
  };
  w.on('moved', onMoved);
  w.on('move', onMoved);

  w.on('closed', () => {
    hiddenSince.delete(w);
    if (guideWin === w) guideWin = null;
  });
}

// 패널은 열 때 마스코트 옆에 자리를 잡을 뿐, 그 뒤로는 마스코트가 어디로 가든 그 자리에
// 머문다. 사용자가 헤더를 잡고 옮겼다면 다음에 열 때도 옮겨둔 자리에 뜬다 — 우리가
// 옮긴 좌표를 기억해 두고, 그와 다른 곳으로 움직였을 때만 사용자가 끈 것으로 본다.
let guidePinnedPos = null;
let guideAutoPos = null;

function moveGuideTo(x, y) {
  guideAutoPos = { x: Math.round(x), y: Math.round(y) };
  safeSetPosition(guideWin, x, y);
}

// 끌어서 화면 밖으로 내보낼 수 없게 — 놓고 나면 보이는 영역 안으로 되돌린다.
// 끄는 도중에 되돌리면 커서와 싸우므로 움직임이 멎은 뒤에 손본다.
function keepGuideOnScreen() {
  if (!guideWin || guideWin.isDestroyed()) return;
  const [x, y] = guideWin.getPosition();
  const [gw, gh] = guideWin.getSize();
  const p = clampedToWorkArea(x, y, gw, gh);
  guidePinnedPos = p;
  if (p.x !== x || p.y !== y) moveGuideTo(p.x, p.y);
}

function positionGuide() {
  if (!win || !guideWin) return;
  if (guidePinnedPos) {
    // 옮겨둔 자리도 화면 밖일 수 있다 — 모니터가 바뀌었다면 안쪽으로 당긴다
    const [gw, gh] = guideWin.getSize();
    guidePinnedPos = clampedToWorkArea(guidePinnedPos.x, guidePinnedPos.y, gw, gh);
    const [cx, cy] = guideWin.getPosition();
    if (cx !== guidePinnedPos.x || cy !== guidePinnedPos.y) {
      moveGuideTo(guidePinnedPos.x, guidePinnedPos.y); // 다시 만들어진 창을 그 자리로
    }
    return;
  }
  const [mx, my] = win.getPosition();
  const wa = screen.getPrimaryDisplay().workArea;
  const gw = CONFIG.guideWidth;
  const gh = CONFIG.guideHeight;
  const gap = 8;

  // 기본: 마스코트 왼쪽에 배치, 하단 정렬
  let gx = mx - gw + 20; // 살짝 겹치게
  let gy = my + CONFIG.height - gh;

  // 왼쪽 공간 부족하면 오른쪽에
  if (gx < wa.x + 4) gx = mx + CONFIG.width - 20;
  // 화면 경계 클램프
  gx = Math.max(wa.x + 4, Math.min(gx, wa.x + wa.width - gw - 4));
  gy = Math.max(wa.y + 4, Math.min(gy, wa.y + wa.height - gh - 4));

  moveGuideTo(gx, gy);
}

// 트레이의 "다시 로드" 로 편집을 바로 반영할 수 있게, 캐시를 버리고 매번 다시 읽는다.
// 파일을 고치다 문법이 깨져도 앱은 살아있어야 하므로 실패는 빈 값으로 넘긴다.
const CONFERENCE_PATH = require.resolve('./shared/conference');
const VITALS_CLIENT_PATH = path.join(__dirname, 'integrations', 'vitals-client.js');
function loadConference() {
  try {
    delete require.cache[CONFERENCE_PATH];
    return require('./shared/conference');
  } catch (e) {
    console.error('[conference] 읽기 실패:', e.message);
    return {};
  }
}

// 자정 기준 날짜 비교로 phase 결정
function conferencePhase(conf) {
  const start = TIME.startOfDay(conf.startDate);
  const end = TIME.startOfDay(conf.endDate || conf.startDate);
  const today = TIME.startOfDay(Date.now());
  // startOfDay 는 빈 값을 오늘로 읽는다 — 날짜가 없으면 종강일로 착각하지 않게 null
  if (!conf.startDate || isNaN(start)) return null;
  if (today < start) return 'before';
  if (today > end) return 'after';
  return 'dayof';
}

function guideData() {
  const conf = loadConference();
  return {
    items: loadSchedule(),
    conference: conf,
    phase: conferencePhase(conf),
    title: CONFIG.guideTitle || '학기 안내',
    subtitle: CONFIG.guideSubtitle,
    now: Date.now(),
  };
}

function pushGuideData() {
  if (!guideWin || guideWin.isDestroyed()) return;
  const send = () => guideWin.webContents.send('guide:data', guideData());
  if (guideWin.webContents.isLoading()) {
    guideWin.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function toggleGuide() {
  if (!guideWin) createGuideWindow();
  if (guideWin.isVisible()) {
    guideWin.hide();
  } else {
    positionGuide();
    pushGuideData();
    guideWin.showInactive(); // 포커스 뺏지 않고 표시
  }
}

function showGuide() {
  if (!guideWin) createGuideWindow();
  positionGuide();
  pushGuideData();
  if (!guideWin.isVisible()) guideWin.showInactive();
}

// ---------------------------------------------------------------------------
// 사용 안내 창
// 처음 실행할 때 저절로 뜨고, "다시 보지 않기" 를 켜고 닫으면 그 뒤로는 트레이
// 메뉴로만 열린다. 앱 폴더는 설치 방식에 따라 쓸 수 없어서 사용자 폴더에 적어둔다.
// ---------------------------------------------------------------------------
const HELP_WIDTH = 460;
const HELP_HEIGHT = 520; // 가장 긴 페이지가 스크롤 없이 들어가게

function uiStatePath() {
  return path.join(app.getPath('userData'), 'ui-state.json');
}

function readUiState() {
  try {
    const p = uiStatePath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('[ui-state] 읽기 실패:', e.message);
  }
  return {};
}

function writeUiState(patch) {
  try {
    const next = { ...readUiState(), ...patch };
    fs.mkdirSync(path.dirname(uiStatePath()), { recursive: true });
    fs.writeFileSync(uiStatePath(), JSON.stringify(next, null, 2) + '\n');
  } catch (e) {
    // 저장에 실패하면 다음에 또 뜨는 것뿐이라 앱을 멈출 이유는 없다
    console.error('[ui-state] 저장 실패:', e.message);
  }
}

function createHelpWindow() {
  helpWin = new BrowserWindow({
    width: HELP_WIDTH,
    height: HELP_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    icon: appIcon(),
    webPreferences: WEB_PREFS,
  });
  helpWin.setAlwaysOnTop(true, 'screen-saver');
  helpWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  helpWin.loadFile(path.join(__dirname, 'renderer', 'help.html'));

  const w = helpWin;
  w.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      w.hide();
    }
  });
  w.on('closed', () => {
    hiddenSince.delete(w);
    if (helpWin === w) helpWin = null;
  });
}

// 화면 한가운데 — 커서가 닿는 영역 기준이라 모니터가 바뀌어도 보이는 곳에 뜬다
function centerHelp() {
  if (!helpWin || helpWin.isDestroyed()) return;
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [hw, hh] = helpWin.getSize();
  const p = clampedToWorkArea(
    Math.round(wa.x + (wa.width - hw) / 2),
    Math.round(wa.y + (wa.height - hh) / 2),
    hw,
    hh
  );
  safeSetPosition(helpWin, p.x, p.y);
}

function showHelp() {
  // 사용 안내 문구는 자주 고치므로, 다시 열 때마다 파일을 새로 읽는다
  if (helpWin && !helpWin.isDestroyed()) {
    helpWin.destroy();
    helpWin = null;
  }
  createHelpWindow();
  centerHelp();
  helpWin.webContents.once('did-finish-load', () => {
    helpWin.webContents.send('help:show');
    helpWin.show();
  });
}

function toggleHelp() {
  if (helpWin && helpWin.isVisible()) {
    helpWin.hide();
    return;
  }
  showHelp();
}

// ---------------------------------------------------------------------------
// 마스코트로 이벤트 전송
// ---------------------------------------------------------------------------
function sendToMascot(channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function scheduleSleep() {
  if (sleepTimer) clearTimeout(sleepTimer);
  asleep = false;
  sleepTimer = setTimeout(() => {
    asleep = true;
    sendToMascot('mascot:state', { state: 'sleeping' });
  }, CONFIG.idleSleepMs);
}

// ---------------------------------------------------------------------------
// 코딩 중 걷기 — 반대 모서리로 이동, 멈추면 제자리 복귀
// ---------------------------------------------------------------------------
function cornerXY(corner) {
  const wa = screen.getPrimaryDisplay().workArea;
  const { width: w, height: h, margin: m } = CONFIG;
  const x = corner.includes('left') ? wa.x + m : wa.x + wa.width - w - m;
  const y = corner.includes('top') ? wa.y + m : wa.y + wa.height - h - m;
  return { x: Math.round(x), y: Math.round(y) };
}
function oppositeCorner(corner) {
  const lr = corner.includes('left') ? 'right' : 'left';
  const tb = corner.includes('top') ? 'bottom' : 'top';
  return `${tb}-${lr}`;
}

function startMover() {
  if (!mover) mover = setInterval(stepWalk, TIME.WALK_TICK_MS);
}
function stopMover() {
  if (mover) {
    clearInterval(mover);
    mover = null;
  }
}
function stepWalk() {
  if (!win || win.isDestroyed() || !walkTarget) {
    stopMover();
    return;
  }
  const [x, y] = win.getPosition();
  const dx = walkTarget.x - x;
  const dy = walkTarget.y - y;
  const dist = Math.hypot(dx, dy);
  if (dist <= WALK_SPEED) {
    safeSetPosition(win, walkTarget.x, walkTarget.y);
    stopMover();
    onArrive();
    return;
  }
  safeSetPosition(win, x + (dx / dist) * WALK_SPEED, y + (dy / dist) * WALK_SPEED);
  const dir = dx < 0 ? -1 : 1;
  if (dir !== lastDir) {
    lastDir = dir;
    sendToMascot('mascot:state', { state: 'walking', dir });
  }
}
function onArrive() {
  walkTarget = null;
  if (walkGoal === 'home') {
    walkGoal = null;
    sendToMascot('mascot:state', { state: 'idle' });
    scheduleSleep();
  } else {
    // 반대 모서리 도착 → 그 자리에서 집중
    sendToMascot('mascot:state', { state: 'working' });
  }
}
function startCodingWalk(data = {}) {
  // 웹훅이 문자열을 보내도 숫자로
  const linger = Number(data.lingerMs || data.ttl) || TIME.WALK_LINGER_MS;
  workingUntil = Date.now() + linger;
  if (walkGoal !== 'away') {
    walkGoal = 'away';
    walkTarget = cornerXY(oppositeCorner(CONFIG.corner));
    sendToMascot('mascot:state', { state: 'walking', dir: lastDir });
    startMover();
  }
  if (returnTimer) clearTimeout(returnTimer);
  returnTimer = setTimeout(() => {
    if (Date.now() >= workingUntil) returnHome();
  }, linger + 60);
}
function returnHome() {
  walkGoal = 'home';
  walkTarget = cornerXY(CONFIG.corner);
  sendToMascot('mascot:state', { state: 'walking', dir: lastDir });
  startMover();
}

// ---------------------------------------------------------------------------
// 가끔 몇 걸음 — 쉬는 중에만 좌우로 살짝 움직인다 (약 5초에 3걸음)
// 코딩 중 걷기와 달리 목적지가 없고, 기준점 주변을 조금씩 오갈 뿐이다.
// ---------------------------------------------------------------------------
const WANDER_STEPS = 3; // 한 번 나설 때 걷는 걸음 수
const WANDER_STEP_PX = 14; // 한 걸음에 이동하는 거리
const WANDER_RANGE_PX = 90; // 기준점에서 벗어날 수 있는 최대 거리
// 걸음에 걸리는 시간과 산책 간격은 shared/time.js (WANDER_*)

let wanderTimer = null; // 다음 산책 예약
let wanderStepTimer = null; // 다음 걸음 예약
let wanderMover = null; // 걸음 진행 인터벌
let wanderHomeX = null; // 산책 기준 x (드래그하면 그 자리로 다시 잡는다)

function stopWander() {
  if (wanderMover) {
    clearInterval(wanderMover);
    wanderMover = null;
  }
  if (wanderStepTimer) {
    clearTimeout(wanderStepTimer);
    wanderStepTimer = null;
  }
}
// 코딩 중 걷기·작업중이면 산책은 양보한다
function wanderBusy() {
  return !!mover || !!walkTarget || Date.now() < workingUntil;
}
function scheduleWander() {
  if (wanderTimer) clearTimeout(wanderTimer);
  wanderTimer = setTimeout(
    startWander,
    TIME.WANDER_MIN_MS + Math.random() * (TIME.WANDER_MAX_MS - TIME.WANDER_MIN_MS)
  );
}
// 오갈 수 있는 x 범위 — 화면 여백과 기준점 반경 중 좁은 쪽
function wanderBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    min: Math.max(wa.x + CONFIG.margin, wanderHomeX - WANDER_RANGE_PX),
    max: Math.min(wa.x + wa.width - CONFIG.width - CONFIG.margin, wanderHomeX + WANDER_RANGE_PX),
  };
}
function startWander() {
  scheduleWander(); // 이번을 건너뛰더라도 다음 산책은 예약해둔다
  if (!win || win.isDestroyed() || asleep || wanderBusy()) return;
  const [x] = win.getPosition();
  if (wanderHomeX == null) wanderHomeX = x;
  const b = wanderBounds();
  if (!Number.isFinite(b.min) || !Number.isFinite(b.max)) return; // 디스플레이 전환 중 — 이번 산책은 쉰다
  // 기본 위치가 화면 모서리라 한쪽은 이미 막혀 있다 — 갈 수 있는 쪽을 고른다
  const blocked = (d) => x + d * WANDER_STEP_PX > b.max || x + d * WANDER_STEP_PX < b.min;
  let dir = Math.random() < 0.5 ? -1 : 1;
  if (blocked(dir)) dir = -dir;
  if (blocked(dir)) return; // 양쪽 다 막혔으면 이번엔 쉰다
  scheduleSleep(); // 산책은 활동 — 잠들기 타이머를 미뤄서 멈추지 않고 계속 돌아다닌다
  takeStep(dir, WANDER_STEPS, b);
}
function takeStep(dir, left, b) {
  if (left <= 0 || !win || win.isDestroyed() || asleep || wanderBusy()) {
    stopWander();
    return;
  }
  const [sx, sy] = win.getPosition();
  const target = Math.min(b.max, Math.max(b.min, sx + dir * WANDER_STEP_PX));
  if (target === sx) {
    sendToMascot('mascot:state', { state: 'idle' }); // 벽에 닿았으면 거기서 멈춘다
    return;
  }
  lastDir = dir;
  sendToMascot('mascot:state', { state: 'walking', dir });

  const ticks = Math.max(1, Math.round(TIME.WANDER_STEP_MS / TIME.WALK_TICK_MS));
  let n = 0;
  wanderMover = setInterval(() => {
    if (!win || win.isDestroyed() || wanderBusy()) {
      stopWander();
      return;
    }
    n++;
    // 시작점→목표를 보간해야 한 틱 이동량이 1px 미만이어도 반올림에 먹히지 않는다
    safeSetPosition(win, sx + (target - sx) * (n / ticks), sy);
    if (n >= ticks) {
      clearInterval(wanderMover);
      wanderMover = null;
      sendToMascot('mascot:state', { state: 'idle' });
      if (left > 1) {
        wanderStepTimer = setTimeout(
          () => takeStep(dir, left - 1, b),
          TIME.WANDER_GAP_MS - TIME.WANDER_STEP_MS
        );
      }
    }
  }, TIME.WALK_TICK_MS);
}

// 외부에서 들어온 활동/알림을 처리하는 공통 함수
function showSystemNotification(data = {}) {
  if (dnd) return;
  if (!Notification.isSupported()) {
    console.warn('[notification] 이 환경에서는 시스템 알림을 지원하지 않습니다.');
    return;
  }

  const note = new Notification({
    title: data.title || '알림',
    body: data.message || '',
    silent: false,
    icon: appIcon(),
  });
  // 표시 전에 GC 되지 않도록 붙잡아 두는 용도 — 닫힘/실패를 못 받는 경우가 있어
  // 시간이 지나면 놓아준다. 안 그러면 며칠 동안 알림 객체가 계속 쌓인다.
  activeNotifications.add(note);
  const release = () => activeNotifications.delete(note);
  note.once('show', () => console.log('[notification] 표시됨:', data.title || '알림'));
  note.once('failed', (_event, error) => {
    console.error('[notification] 표시 실패:', error || 'unknown error');
    release();
  });
  note.once('close', release);
  setTimeout(release, TIME.NOTIFICATION_RELEASE_MS);
  note.show();
}

function handleEvent(kind, data = {}) {
  scheduleSleep();
  if (kind === 'notify') {
    sendToMascot('mascot:notify', {
      title: data.title || '알림',
      message: data.message || '',
      level: data.level || 'info', // info | success | warn | urgent
      reaction: data.reaction, // 지정하면 기본 반응 대신 이 표정 (ANIM 등록된 이름)
    });
    if (!dnd) {
      try {
        showSystemNotification(data);
      } catch (e) {
        console.error('[notification] 예외:', e.message);
      }
    }
  } else if (kind === 'activity') {
    // 타이핑/코딩 등 사용자 활동 → 반대 모서리로 걸어감 (멈추면 복귀)
    startCodingWalk(data);
  } else if (kind === 'state') {
    // 파일명·문서의 surprise 와 런타임 상태 notify 를 같은 것으로 본다
    const state = data.state === 'surprise' ? 'notify' : data.state;
    sendToMascot('mascot:state', { state, ttl: data.ttl });
  }
}

// ---------------------------------------------------------------------------
// Web Vitals + HTTP 웹훅 서버 (로직은 lib/ 로 분리)
// ---------------------------------------------------------------------------
const handleVitals = createVitalsHandler({
  TIME,
  getDnd: () => dnd,
  scheduleSleep,
  sendToMascot,
});

function startServer() {
  server = startWebhookServer({
    port: CONFIG.port,
    token: CONFIG.token,
    getDnd: () => dnd,
    getVersion: () => app.getVersion(),
    handleEvent,
    handleVitals,
    vitalsClientPath: VITALS_CLIENT_PATH,
    onListenError: (e) => {
      if (e && e.code === 'EADDRINUSE') {
        console.error(
          `[server] 포트 ${CONFIG.port} 이(가) 이미 사용 중입니다. ` +
            `다른 ${BRAND.NAME} 앱이나 프로세스를 끄거나 MASCOT_PORT·config.json 의 port 를 바꾸세요.`
        );
        app.quit();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// 행사 세션 스케줄
// ---------------------------------------------------------------------------
// 세션에는 "13:00" 처럼 시:분만 적는다 — 날짜는 shared/conference.js 의 행사 날짜에서
// 물려받으므로, 행사 날짜 한 줄만 고치면 스케줄이 통째로 따라온다. 여러 날 행사면
// day: 2 로 며칠째인지 적는다. 전체 날짜를 적어두면 그 날짜를 그대로 쓴다.
function resolveSessionTime(item, conf) {
  const raw = String(item.time || '').trim();
  if (!raw) return NaN;
  if (!/^\d{1,2}:\d{2}$/.test(raw)) return new Date(raw).getTime();

  const base = TIME.startOfDay(conf.startDate);
  if (isNaN(base)) return NaN;
  const [h, m] = raw.split(':').map(Number);
  const d = new Date(base);
  d.setDate(d.getDate() + Math.max(0, (Number(item.day) || 1) - 1));
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// 시각을 여기서 한 번 확정해, 알림 예약과 두 패널이 모두 같은 절대 시각을 본다.
function loadSchedule() {
  const conf = loadConference();
  const raw = Array.isArray(conf.sessions) ? conf.sessions : [];
  return raw
    .map((it) => {
      const at = resolveSessionTime(it, conf);
      if (isNaN(at)) {
        // 조용히 사라지면 왜 알림이 안 오는지 알 수 없다
        console.error('[schedule] 시각을 읽을 수 없어 건너뜀:', JSON.stringify(it.time));
        return null;
      }
      return { ...it, time: new Date(at).toISOString() };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.time) - new Date(b.time));
}

// 행사 정보를 고치면 앱을 끄지 않고 반영한다. 편집기가 파일을 지웠다 새로 쓰는 식으로
// 저장해도 놓치지 않게 파일이 아니라 폴더를 지켜보고, 한 번 저장에 이벤트가 여러 번
// 오기 때문에 잠깐 모아서 한 번만 다시 읽는다.
let confWatcher = null;
let confReloadTimer = null;

function watchConference() {
  try {
    confWatcher = fs.watch(path.dirname(CONFERENCE_PATH), (_ev, file) => {
      if (file !== path.basename(CONFERENCE_PATH)) return;
      clearTimeout(confReloadTimer);
      confReloadTimer = setTimeout(() => {
        console.log('[conference] 바뀐 내용을 다시 읽습니다');
        armSchedule();
        pushGuideData();
      }, TIME.CONF_RELOAD_MS);
    });
  } catch (e) {
    // 지켜보기에 실패해도 앱을 다시 켜면 반영된다 — 기능이 아니라 편의다
    console.error('[conference] 파일 감시 실패:', e.message);
  }
}

// setTimeout 은 약 24.8일(MAX_TIMEOUT_MS)이 넘는 지연을 받으면 오버플로로 즉시 실행된다.
// 행사 일정은 몇 주 뒤가 흔해서 그대로 두면 앱을 켜자마자 알림이 쏟아진다.
function scheduleAt(delay, fn) {
  const ref = { handle: null };
  const arm = (remaining) => {
    if (remaining <= TIME.MAX_TIMEOUT_MS) {
      ref.handle = setTimeout(fn, remaining);
    } else {
      ref.handle = setTimeout(() => arm(remaining - TIME.MAX_TIMEOUT_MS), TIME.MAX_TIMEOUT_MS);
    }
  };
  arm(delay);
  return ref;
}

function cancelScheduled(ref) {
  if (ref && ref.handle) clearTimeout(ref.handle);
}

function armSchedule() {
  scheduledTimers.forEach(cancelScheduled);
  scheduledTimers.length = 0;

  const items = loadSchedule();
  const now = Date.now();
  for (const it of items) {
    const t = new Date(it.time).getTime();
    if (isNaN(t)) continue;
    // 세션 시작 leadMinutes(기본 DEFAULT_LEAD_MIN) 전에 알림
    const lead = (it.leadMinutes != null ? it.leadMinutes : TIME.DEFAULT_LEAD_MIN) * TIME.MIN;
    const fireAt = t - lead;
    const delay = fireAt - now;
    if (delay <= 0) continue; // 이미 지난 건 무시
    scheduledTimers.push(
      scheduleAt(delay, () => {
        handleEvent('notify', {
          title: it.title || '세션 안내',
          message: it.message || `곧 시작합니다: ${it.title || ''}`,
          level: it.level || 'info',
        });
      })
    );
  }
  console.log(`[schedule] 예약된 알림 ${scheduledTimers.length}개`);
}

// ---------------------------------------------------------------------------
// 트레이
// ---------------------------------------------------------------------------
function trayIcon() {
  // macOS 는 검정 실루엣을 템플릿으로 칠하고, 그 밖은 컬러 아이콘 그대로 (lib/config.js)
  const img = nativeImage.createFromPath(TRAY_ICON_PATH);
  if (img.isEmpty()) return nativeImage.createEmpty();
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '📋 학기 안내', click: () => toggleGuide() },
    {
      label: dnd ? '🔕 방해 금지: 켜짐' : '🔔 방해 금지: 꺼짐',
      click: () => {
        dnd = !dnd;
        sendToMascot('mascot:dnd', { dnd });
        rebuildTray();
      },
    },
    { label: '📖 사용 안내', click: () => toggleHelp() },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
}

function rebuildTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip(`${BRAND.NAME} · ${BRAND.ORG} 마스코트`);
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => handleEvent('state', { state: 'greet' }));
}

// ---------------------------------------------------------------------------
// IPC (렌더러 → 메인)
// ---------------------------------------------------------------------------
ipcMain.handle('mascot:getAnims', () => loadAnims(path.join(ROOT, 'character')));
ipcMain.on('mascot:setIgnoreMouse', (_e, ignore) => {
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(!!ignore, { forward: true });
  }
});
// 창 안에서 캐릭터가 그려지는 칸 (렌더러가 알려준다). 못 받았으면 창 전체로 본다.
let charBox = null;
ipcMain.on('mascot:charBox', (_e, box = {}) => {
  const ok = ['left', 'top', 'right', 'bottom'].every((k) => Number.isFinite(box[k]));
  if (ok) charBox = box;
});

// 마스코트가 화면 밖으로 나가지 못하게 — 창은 말풍선 자리까지 포함해 캐릭터보다 훨씬
// 크므로, 창이 아니라 캐릭터가 그려지는 칸이 화면 안에 남도록 잡는다. 창 모서리는
// 투명하니 화면 밖으로 나가도 보이지 않는다.
function clampMascotPos(x, y) {
  const b = charBox || { left: 0, top: 0, right: CONFIG.width, bottom: CONFIG.height };
  const wa = screen.getDisplayNearestPoint({ x: x + b.left, y: y + b.top }).workArea;
  const minX = wa.x - b.left;
  const maxX = wa.x + wa.width - b.right;
  const minY = wa.y - b.top;
  const maxY = wa.y + wa.height - b.bottom;
  return {
    x: Math.min(Math.max(x, Math.min(minX, maxX)), Math.max(minX, maxX)),
    y: Math.min(Math.max(y, Math.min(minY, maxY)), Math.max(minY, maxY)),
  };
}

// 안내 패널과 같은 방식 — 커서가 경계 밖으로 나간 만큼을 따로 기억해야 되돌아올 때
// 잡은 지점이 어긋나지 않는다.
let mascotDragIntent = null;

function dragMascot(dx, dy) {
  if (!win || win.isDestroyed()) return;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  stopWander(); // 끌고 가는 중엔 산책이 위치를 건드리지 않게
  if (!mascotDragIntent) {
    const [x, y] = win.getPosition();
    mascotDragIntent = { x, y };
  }
  const wanted = { x: mascotDragIntent.x + dx, y: mascotDragIntent.y + dy };
  const limit = clampMascotPos(wanted.x, wanted.y);
  mascotDragIntent = {
    x: Math.min(Math.max(wanted.x, limit.x - DRAG_SLACK), limit.x + DRAG_SLACK),
    y: Math.min(Math.max(wanted.y, limit.y - DRAG_SLACK), limit.y + DRAG_SLACK),
  };
  safeSetPosition(win, limit.x, limit.y);
  wanderHomeX = null; // 놓은 자리를 새 기준점으로
}

ipcMain.on('mascot:dragStart', () => {
  mascotDragIntent = null;
});
ipcMain.on('mascot:drag', (_e, { dx, dy } = {}) => dragMascot(dx, dy));
ipcMain.on('mascot:click', () => {
  // 인사 + D-day 팝업은 렌더러가 창 안 오버레이로 처리 (안내 패널은 트레이에서)
  scheduleSleep();
});

ipcMain.handle('guide:getData', () => guideData());
ipcMain.on('guide:close', () => {
  if (guideWin && guideWin.isVisible()) guideWin.hide();
});

// 패널 드래그 — 커서가 화면 밖으로 나가도 창은 경계에서 멈춘다
function attachPanelDrag(channel, getWin, onMoved) {
  let intent = null;
  ipcMain.on(`${channel}:dragStart`, () => {
    intent = null;
  });
  ipcMain.on(`${channel}:drag`, (_e, { dx, dy } = {}) => {
    const w = getWin();
    if (!w || w.isDestroyed()) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const [ww, wh] = w.getSize();
    if (!intent) {
      const [x, y] = w.getPosition();
      intent = { x, y };
    }
    intent = clampedToWorkArea(intent.x + dx, intent.y + dy, ww, wh, DRAG_SLACK);
    const p = clampedToWorkArea(intent.x, intent.y, ww, wh);
    if (onMoved) onMoved(p);
    else safeSetPosition(w, p.x, p.y);
  });
}

attachPanelDrag('guide', () => guideWin, (p) => {
  guidePinnedPos = p;
  moveGuideTo(p.x, p.y);
});
attachPanelDrag('help', () => helpWin);

// 사용 안내 — 닫을 때 "다시 보지 않기" 여부를 같이 받는다
ipcMain.on('help:close', (_e, { dontShowAgain } = {}) => {
  if (dontShowAgain) writeUiState({ hideHelp: true });
  if (helpWin && helpWin.isVisible()) helpWin.hide();
});

ipcMain.on('open:external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
});

// ---------------------------------------------------------------------------
// 앱 라이프사이클
// ---------------------------------------------------------------------------
if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (!win.isVisible()) win.show();
      handleEvent('state', { state: 'greet' });
    }
  });

  app.whenReady().then(() => {
    applyAppBranding();
    if (process.platform === 'darwin' && app.dock) app.dock.hide(); // 독 아이콘 숨김
    createWindow();
    createTray();
    startServer();
    armSchedule();
    scheduleSleep();
    scheduleWander();
    hiddenSweeper = setInterval(sweepHiddenWindows, TIME.HIDDEN_SWEEP_MS);

    // 전역 단축키 — 실패하면 조용히 무시하지 않고 남긴다
    const registerShortcut = (accel, fn) => {
      const ok = globalShortcut.register(accel, fn);
      if (!ok) console.error('[shortcut] 등록 실패:', accel);
    };
    registerShortcut('CommandOrControl+Shift+M', () => {
      if (!win) return;
      if (win.isVisible()) win.hide();
      else win.show();
    });
    registerShortcut('CommandOrControl+Shift+H', () =>
      handleEvent('state', { state: 'greet' })
    );

    const onDisplayChange = () => {
      stopWander();
      clampWindowToScreen(win);
      wanderHomeX = null; // 옮겨진 자리를 새 기준점으로
      if (guideWin && guideWin.isVisible()) positionGuide();
    };
    screen.on('display-metrics-changed', onDisplayChange);
    screen.on('display-added', onDisplayChange);
    screen.on('display-removed', onDisplayChange);

    // 맥이 몇 시간 자고 일어나면 예약은 이미 지나 있고 창은 엉뚱한 곳에 있을 수 있다
    powerMonitor.on('resume', () => {
      armSchedule();
      scheduleSleep();
      clampWindowToScreen(win);
    });

    watchConference();

    // 첫 인사
    setTimeout(() => handleEvent('state', { state: 'greet' }), TIME.FIRST_GREET_MS);

    // 처음 깔았을 때는 무엇을 할 수 있는 앱인지 알려준다.
    // "다시 보지 않기" 를 켜고 닫았다면 트레이 메뉴로만 열린다.
    if (!readUiState().hideHelp) {
      setTimeout(showHelp, TIME.HELP_FIRST_SHOW_MS);
    }
  });
}

app.on('window-all-closed', () => {
  // 트레이 상주 앱 — 창 닫혀도 종료하지 않음
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopMover();
  stopWander();
  if (wanderTimer) clearTimeout(wanderTimer);
  if (returnTimer) clearTimeout(returnTimer);
  if (sleepTimer) clearTimeout(sleepTimer);
  if (hiddenSweeper) clearInterval(hiddenSweeper);
  if (confReloadTimer) clearTimeout(confReloadTimer);
  if (confWatcher) confWatcher.close();
  scheduledTimers.forEach(cancelScheduled);
  if (server) server.close();
});
