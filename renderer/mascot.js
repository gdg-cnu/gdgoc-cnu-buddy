'use strict';

// ===========================================================================
// 마스코트 — GDGoC CNU 초록 TV 머리 로봇
// 그림: character/gdg-0N.png 스티커 (정면 일러스트, 높이 240px 통일)
//   상태마다 표정 스티커를 고르고, 움직임은 전부 코드 모션(숨쉬기·점프·흔들기…)이다.
//   좌우 반전은 하지 않는다 — 배의 GDG 로고가 뒤집힌다.
// 이펙트(하트/Zzz/!/?)는 캔버스에 직접 그린다.
// 말풍선/D-day 팝업: CSS 박스·SVG 모양·JSON 픽셀 말풍선 + MonaS12 픽셀 폰트
// ===========================================================================

const cv = document.getElementById('cat');
const ctx = cv.getContext('2d');

// 논리 좌표 = CSS px (style.css 의 #cat 크기). 백킹은 화면 배율만큼, 최소 2배
const LW = 140;
const LH = 140;
const SCALE = Math.max(2, window.devicePixelRatio || 1);
cv.width = LW * SCALE;
cv.height = LH * SCALE;
ctx.scale(SCALE, SCALE);
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';

const bubble = document.getElementById('bubble');
const bTitle = document.getElementById('bubble-title');
const bMsg = document.getElementById('bubble-msg');
const dndBadge = document.getElementById('dnd-badge');

// ---- 애니메이션 레지스트리 ---------------------------------------------------
// frames: character/<이름>.png — 여러 장이면 fps 로 돌린다 (loop 가 아니면 마지막 장에서 멈춤)
// motion: 코드 모션(pose), fx: 이펙트(drawFx), ms: 1회성 상태가 머무는 시간 = 모션 한 번 길이
const ANIM = {
  idle: { frames: ['gdg-04'], fps: 0, loop: true, motion: 'breathe' },
  sleeping: { frames: ['gdg-06'], fps: 0, loop: true, motion: 'sleep', fx: 'zzz' },
  walking: { frames: ['gdg-04'], fps: 0, loop: true, motion: 'walk' },
  working: { frames: ['gdg-02'], fps: 0, loop: true, motion: 'typing' },
  happy: { frames: ['gdg-05'], fps: 0, loop: true, motion: 'hop' },
  notify: { frames: ['gdg-03'], fps: 0, loop: true, motion: 'startle', fx: 'bang' },
  greet: { frames: ['gdg-07'], fps: 0, loop: false, motion: 'wave', ms: 1200 },
  love: { frames: ['gdg-01'], fps: 0, loop: false, motion: 'pulse', fx: 'hearts', ms: 1600 },
  curious: { frames: ['gdg-04'], fps: 0, loop: false, motion: 'tilt', fx: 'question', ms: 1400 },
  peek: { frames: ['gdg-07'], fps: 0, loop: false, motion: 'peek', ms: 1500 },
  wake: { frames: ['gdg-06', 'gdg-04'], fps: 2.5, loop: false, motion: 'stretch', ms: 900 }, // 0.4초에 눈을 뜬다
};

// ---- 스티커 배치 -------------------------------------------------------------
const CHAR_H = 96; // 화면에서의 캐릭터 키 (CSS px)
const K = CHAR_H / 240; // 스티커 원본 높이 240px → CHAR_H
// 모든 스티커의 발(바닥 중앙)을 여기 맞춰 상태가 바뀌어도 발이 튀지 않게 한다.
// 아래 4px 는 몸을 기울일 때 발끝이 잘리지 않을 여유, 위쪽은 점프·이펙트 자리.
const FOOT_X = LW / 2;
const FOOT_Y = LH - 4;
// 몸통 중심이 그림 중앙보다 왼쪽인 스티커 (원본 px) — 02 는 노트북이 오른쪽으로 삐져나와 있다
const CENTER_SHIFT = { 'gdg-02': 16 };
const FADE_MS = 150; // 상태 전환 크로스페이드

// ---- 픽셀 말풍선 렌더링 (character/bubble-*.json, 마름모 캡슐 병합) ----------
let animsRaw = null; // { 'bubble-…': { pages } }

function skewX(y, H, tanA) {
  return (H - y) * tanA; // 위로 갈수록 오른쪽 (원본 아트 기울기)
}

function toward(a, b, dist) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.min(0.5, dist / len);
  return [a[0] + dx * t, a[1] + dy * t];
}

// 둥근 마름모 블록 — (x,y,w,h)는 스큐 전 그리드 px 사각형
function drawBlock(g, x, y, w, h, color, m) {
  x -= m.ov;
  y -= m.ov;
  w += m.ov * 2;
  h += m.ov * 2;
  const P = [
    [x + skewX(y, m.H, m.tanA), y],
    [x + w + skewX(y, m.H, m.tanA), y],
    [x + w + skewX(y + h, m.H, m.tanA), y + h],
    [x + skewX(y + h, m.H, m.tanA), y + h],
  ];
  const r = Math.min(m.r, w / 2, h / 2);
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const p = P[i];
    const a = toward(p, P[(i + 3) % 4], r);
    const b = toward(p, P[(i + 1) % 4], r);
    if (i === 0) g.moveTo(a[0], a[1]);
    else g.lineTo(a[0], a[1]);
    g.quadraticCurveTo(p[0], p[1], b[0], b[1]);
  }
  g.closePath();
  g.fill();
}

function buildFrame(page, cell) {
  const cfg = page.cfg;
  const tanA = Math.tan((Math.abs(cfg.angleDeg) * Math.PI) / 180);
  const H = cfg.rows * cell;
  const c = document.createElement('canvas');
  c.width = Math.ceil(cfg.cols * cell + H * tanA) + 4;
  c.height = H + 4;
  const g = c.getContext('2d');
  g.translate(2, 2);
  const m = {
    H,
    tanA,
    r: (cfg.radius / cfg.cell) * cell,
    ov: (cfg.overlap / cfg.cell) * cell,
  };

  // 1) 가로 같은 색 run 병합 → 캡슐. 길이 1은 세로 병합 후보로 보류
  const singles = [];
  for (let y = 0; y < cfg.rows; y++) {
    const row = page.grid[y] || [];
    for (let x = 0; x < cfg.cols; ) {
      const col = row[x];
      if (!col) {
        x++;
        continue;
      }
      let x2 = x;
      while (x2 + 1 < cfg.cols && row[x2 + 1] === col) x2++;
      if (x2 > x) drawBlock(g, x * cell, y * cell, (x2 - x + 1) * cell, cell, col, m);
      else singles.push({ x, y, col });
      x = x2 + 1;
    }
  }
  // 2) 외따로 선 세로 열(더듬이 줄기 등) → 세로 캡슐
  singles.sort((a, b) => a.x - b.x || a.y - b.y);
  for (let i = 0; i < singles.length; ) {
    const s = singles[i];
    let j = i;
    while (
      j + 1 < singles.length &&
      singles[j + 1].x === s.x &&
      singles[j + 1].y === singles[j].y + 1 &&
      singles[j + 1].col === s.col
    )
      j++;
    drawBlock(g, s.x * cell, s.y * cell, cell, (j - i + 1) * cell, s.col, m);
    i = j + 1;
  }
  return c;
}

if (window.mascot && window.mascot.getAnims) {
  window.mascot.getAnims().then((d) => {
    animsRaw = d;
    applyBubbleStyle(bubbleStyle); // JSON 픽셀 말풍선 준비
  });
}

// ---- 말풍선 스타일 — 기존 SVG or JSON 픽셀 말풍선 (character/bubble-*.json) ----
// 텍스트가 길면 캡(모서리·꼬리·탭)은 그대로 두고 중앙의 균일한 컬럼을
// 그리드 규칙대로 복제해 좌우로 넓힌다 (insL/insR = 삽입 지점, 꼬리 양옆).
// baseW/cellCss 는 기본 표시 폭과 셀 1칸의 CSS px, padL/padR 는 텍스트 여백.
const bubbleImg = document.getElementById('bubble-img');
const bubbleShape = document.getElementById('bubble-shape');
const bText = document.getElementById('bubble-text');
const BUBBLE_STYLES = {
  classic: null, // 기존 SVG 생각풍선 (고정 크기)
  // 몸통을 CSS 박스로 그려서 텍스트만큼 저절로 늘어난다 (style.css)
  gdg: { css: true }, // 진한 초록 알림
  banner: { css: true }, // 흰 텍스트 배너
  comic: { file: 'bubble-comic', baseW: 208, cellCss: 6.05, insL: 6, insR: 20, padL: 32, padR: 24 },
  purple: { file: 'bubble-purple', baseW: 196, cellCss: 7.38, insL: 6, insR: 16, padL: 26, padR: 18 },
  cozy: { file: 'bubble-cozy', baseW: 212, cellCss: 5.83, insL: 9, insR: 24, padL: 28, padR: 18 },
};
let bubbleStyle = 'gdg'; // 기본 말풍선 — D-day 팝업과 같은 폼
const BUBBLE_MAX_W = 245; // 오른쪽으로 옮긴 좌측 기준에서도 창(315px) 안에 들어오는 최대 폭

// 텍스트 폭 측정이 실제 폰트로 되도록 미리 로드
if (document.fonts && document.fonts.load) {
  document.fonts.load('400 12px MonaS12');
  document.fonts.load('700 12px MonaS12'); // 캔버스 이펙트 글자
  document.fonts.load('400 12.5px Pretendard');
  document.fonts.load('400 11.5px Pretendard');
}

// 이미지를 다시 뽑아 스트레치해야 하는 JSON 픽셀 말풍선만 골라낸다.
// classic(SVG)·gdg·banner(CSS 박스)는 폭을 CSS가 알아서 잡으므로 대상이 아니다.
function pixelConf(style) {
  const c = BUBBLE_STYLES[style];
  return c && !c.css ? c : null;
}

const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(text, font) {
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

// 중앙 컬럼 복제 — insL/insR 위치의 컬럼을 extra 칸만큼 늘린다 (좌우 반반)
function stretchPage(page, insL, insR, extra) {
  const nL = Math.floor(extra / 2);
  const nR = extra - nL;
  const grid = page.grid.map((row) => {
    const r = [];
    for (let x = 0; x < page.cfg.cols; x++) {
      if (x === insL) for (let k = 0; k < nL; k++) r.push(row[x] || null);
      if (x === insR) for (let k = 0; k < nR; k++) r.push(row[x] || null);
      r.push(x < row.length ? row[x] || null : null);
    }
    return r;
  });
  return { cfg: { ...page.cfg, cols: page.cfg.cols + extra }, grid };
}

// 현재 제목/메시지 폭에 맞춰 말풍선 이미지를 다시 뽑고 폭을 지정
function sizeBubble() {
  const conf = pixelConf(bubbleStyle);
  if (!conf) {
    bubble.style.width = '';
    return;
  }
  const data = animsRaw && animsRaw[conf.file.normalize('NFC')];
  if (!data) return;
  const pret = document.body.classList.contains('font-pretendard');
  const titleF = pret ? '400 12.5px Pretendard, sans-serif' : '400 12px MonaS12, sans-serif';
  const msgF = pret ? '400 11.5px Pretendard, sans-serif' : '400 12px MonaS12, sans-serif';
  const tw = Math.max(
    textWidth(bTitle.textContent, titleF),
    bMsg.style.display === 'none' ? 0 : textWidth(bMsg.textContent, msgF)
  );
  const needW = conf.padL + tw + 8 + conf.padR;
  const maxExtra = Math.floor((BUBBLE_MAX_W - conf.baseW) / conf.cellCss);
  const extra = Math.max(0, Math.min(maxExtra, Math.ceil((needW - conf.baseW) / conf.cellCss)));
  conf.cache = conf.cache || {};
  if (!conf.cache[extra]) {
    conf.cache[extra] = buildFrame(stretchPage(data.pages[0], conf.insL, conf.insR, extra), 16).toDataURL();
  }
  bubbleImg.src = conf.cache[extra];
  bubble.style.width = Math.round(conf.baseW + extra * conf.cellCss) + 'px';
}

function applyBubbleStyle(style) {
  if (!(style in BUBBLE_STYLES)) return;
  bubbleStyle = style;
  const conf = pixelConf(style);
  if (!conf) {
    // classic 은 인라인 SVG 모양, gdg/banner 는 CSS 박스라 모양 레이어가 없다
    bubbleShape.classList.toggle('hidden', !!BUBBLE_STYLES[style]);
    bubbleImg.classList.add('hidden');
    bubble.style.width = '';
    bText.style.left = '';
    bText.style.right = '';
  } else {
    const data = animsRaw && animsRaw[conf.file.normalize('NFC')];
    if (!data) return; // 로드 전이면 getAnims 완료 시 재적용됨
    bText.style.left = conf.padL + 'px'; // 캡 폭은 고정 px (스트레치와 무관)
    bText.style.right = conf.padR + 'px';
    sizeBubble();
    bubbleShape.classList.add('hidden');
    bubbleImg.classList.remove('hidden');
  }
  syncBubbleClass();
}
// level-* 클래스와 style-* 클래스를 함께 유지
function syncBubbleClass(level) {
  const lv = level || (bubble.className.match(/level-(\w+)/) || [])[1] || 'info';
  bubble.className =
    'level-' + lv + (BUBBLE_STYLES[bubbleStyle] ? ' style-' + bubbleStyle : '') +
    (bubble.classList.contains('hidden') ? ' hidden' : '');
}

// ---- 상태 관리 --------------------------------------------------------------
let baseState = 'idle'; // idle | sleeping | walking | working (지속 상태)
let temp = null; // { state, until }  (일시 상태)
let walkDir = -1; // 걷는 방향(-1 왼쪽, +1 오른쪽)
const BASE_STATES = ['idle', 'sleeping', 'walking', 'working'];

function effectiveState() {
  if (temp && performance.now() < temp.until) return temp.state;
  temp = null;
  return baseState;
}

function setTemp(state, ttl) {
  temp = { state, until: performance.now() + (ttl || defaultTtl(state)) };
}

// 일회성 감정은 모션 한 번 길이만큼
function defaultTtl(state) {
  const a = ANIM[state];
  return a.loop ? TIME.TEMP_LOOP_MS : a.ms;
}

// 잠에서 깨는 전환 — 깸 애니메이션을 먼저 재생하고 이어서 next 실행
function wakeThen(next) {
  setTemp('wake');
  if (next) setTimeout(next, defaultTtl('wake'));
}

// ===========================================================================
// 캐릭터 렌더링
// ===========================================================================
let lastState = null;
let stateStart = 0;
let nextQuirk = -1; // idle 중 가끔 갸웃/빼꼼 (-1 = 아직 예약 전)

let lastSig = ''; // 마지막으로 그린 그림의 식별자
let shown = null; // 마지막으로 그린 { name, img, p } — 크로스페이드 출발점
let fade = null; // 사라지는 중인 이전 그림 { name, img, p, start }
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const REST = { x: 0, y: 0, sx: 1, sy: 1, r: 0 };

// 로드 전이거나 실패한 스티커는 null — 그 프레임은 건너뛴다
const stickers = {};
function sticker(name) {
  let img = stickers[name];
  if (!img) {
    img = stickers[name] = new Image();
    img.src = `../character/${name}.png`;
  }
  return img.complete && img.naturalWidth ? img : null;
}
for (const a of Object.values(ANIM)) a.frames.forEach(sticker); // 첫 전환에서 비지 않게 미리 읽는다

// 키프레임 [[ms, 값], …] 사이를 부드럽게(smoothstep) 잇는다
function kf(t, keys) {
  let [t0, v0] = keys[0];
  if (t <= t0) return v0;
  for (const [t1, v1] of keys) {
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * u * u * (3 - 2 * u);
    }
    [t0, v0] = [t1, v1];
  }
  return v0;
}

// 코드 모션 — 상태가 시작되고 t ms 뒤의 몸 변형 (d = 이 상태가 머무는 시간).
// 발을 축으로 x·y 이동(px, 위가 -), sx·sy 늘이기, r 회전(rad, + 는 시계 방향)
function pose(a, t, d) {
  const p = { x: 0, y: 0, sx: 1, sy: 1, r: 0 };
  const sin = (ms) => Math.sin((2 * Math.PI * t) / ms);
  const osc = (ms) => (1 - Math.cos((2 * Math.PI * t) / ms)) / 2; // 0→1→0
  switch (a.motion) {
    case 'breathe': // 세로로 1.5% 늘었다 줄었다
      p.sy = 1 + 0.015 * osc(3200);
      break;
    case 'sleep': // 깊고 느린 숨 — 배가 옆으로도 부푼다
      p.sy = 1 + 0.03 * osc(4500);
      p.sx = 1 + 0.012 * osc(4500);
      break;
    case 'typing': // 자판 두드리는 잔떨림 + 노트북 쪽으로 살짝 숙이기
      p.y = -1.5 * Math.abs(sin(360));
      p.r = 0.035;
      break;
    case 'hop': {
      // 앞 30% 는 땅에서 납작해졌다 펴고, 나머지는 공중 — 빠를수록(뜰 때·내릴 때) 길쭉
      const u = (t % 600) / 600; // 1800·3000 ms 의 약수라 상태가 끝날 때 착지해 있다
      if (u < 0.3) {
        const q = Math.sin((Math.PI * u) / 0.3);
        p.sy = 1.06 - 0.16 * q;
        p.sx = 0.97 + 0.1 * q;
      } else {
        const v = (u - 0.3) / 0.7;
        const k = Math.abs(1 - 2 * v);
        p.y = -56 * v * (1 - v); // 꼭대기 14px
        p.sy = 1 + 0.06 * k;
        p.sx = 1 - 0.03 * k;
      }
      break;
    }
    case 'startle': // 깜짝 튀어올랐다가 좌우로 부들부들 — 유지되면 약하게 계속 떤다
      if (t < 360) {
        p.y = -12 * Math.sin((Math.PI * t) / 360);
        p.sy = 1 + 0.05 * Math.sin((Math.PI * t) / 360);
      } else {
        p.x = (1 + 4 * Math.exp(-(t - 360) / 300)) * Math.sin((2 * Math.PI * (t - 360)) / 120);
      }
      break;
    case 'wave': // 좌우로 6도씩 흔들며 인사
      p.r = 0.1 * sin(400);
      break;
    case 'pulse': {
      // 두근두근 — 0.8초에 두 번 뛴다
      const u = (t % 800) / 800;
      p.sx = p.sy = 1 + 0.06 * (Math.exp(-(((u - 0.1) / 0.06) ** 2)) + 0.6 * Math.exp(-(((u - 0.3) / 0.06) ** 2)));
      break;
    }
    case 'tilt': // '?' 쪽(왼쪽)으로 갸웃했다가 끝날 때 돌아온다
      p.r = kf(t, [[0, 0], [250, -0.14], [d - 300, -0.14], [d, 0]]);
      break;
    case 'peek': // 바닥 아래로 쏙 숨었다가 눈만 빼꼼, 그리고 쑥
      p.y = kf(t, [[0, 0], [200, CHAR_H * 0.9], [650, CHAR_H * 0.9], [950, CHAR_H * 0.5], [1250, CHAR_H * 0.5], [1500, 0]]);
      break;
    case 'stretch': // 기지개 — 세로로 쭉 늘었다가 살짝 눌리며 안착
      p.sy = kf(t, [[0, 1], [450, 1.1], [650, 0.95], [900, 1]]);
      p.sx = 1 - (p.sy - 1) / 2;
      break;
    case 'walk': // 한 발씩 통통, 좌우 번갈아 기울며 가는 쪽으로 살짝 숙인다
      p.y = -3 * Math.abs(sin(600));
      p.r = 0.04 * sin(600) + walkDir * 0.05;
      break;
  }
  return p;
}

// 스티커를 발 기준으로 변형해 그린다. clip: 바닥선 아래는 숨긴다(빼꼼)
function drawSticker({ name, img, p }, alpha, clip) {
  const w = img.naturalWidth * K;
  const h = img.naturalHeight * K;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (clip) {
    ctx.beginPath();
    ctx.rect(0, 0, LW, FOOT_Y);
    ctx.clip();
  }
  ctx.translate(FOOT_X + p.x, FOOT_Y + p.y);
  ctx.rotate(p.r);
  ctx.scale(p.sx, p.sy);
  ctx.drawImage(img, -w / 2 + (CENTER_SHIFT[name] || 0) * K, -h, w, h);
  ctx.restore();
}

// ---- 이펙트 — 말풍선이 머리 오른쪽 위를 덮으므로 왼쪽 위에 띄운다 ----------------
const FX_X = FOOT_X - 38;
const FX_Y = FOOT_Y - CHAR_H; // 머리 꼭대기 높이
const INK = '#202124';

// 외곽선을 두른 픽셀 폰트 글자 — 어떤 바탕화면 위에서도 보이게
function glyph(ch, x, y, px, fill, stroke, alpha, rot) {
  if (px <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `700 ${px}px MonaS12, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = px / 6;
  ctx.strokeStyle = stroke;
  ctx.strokeText(ch, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(ch, 0, 0);
  ctx.restore();
}

function heart(x, y, s, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.bezierCurveTo(-1, -8, -8, -7, -8, -2);
  ctx.bezierCurveTo(-8, 2, -3, 5, 0, 8);
  ctx.bezierCurveTo(3, 5, 8, 2, 8, -2);
  ctx.bezierCurveTo(8, -7, 1, -8, 0, -3);
  ctx.fillStyle = '#EA4335';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

function drawFx(fx, t, d) {
  if (fx === 'bang') {
    // 튀어나오듯 커졌다 자리 잡고, 유지되는 동안 까딱인다
    const s = kf(t, [[0, 0], [120, 1.3], [220, 1]]);
    glyph('!', FX_X, FX_Y - 2, 26 * s, '#EA4335', INK, 1, -0.2 + 0.1 * Math.sin(t / 100));
  } else if (fx === 'question') {
    const s = kf(t, [[150, 0], [300, 1.3], [400, 1]]);
    glyph('?', FX_X - 6, FX_Y - 2, 26 * s, '#4285F4', INK, kf(t, [[d - 250, 1], [d, 0]]), -0.25);
  } else if (fx === 'zzz') {
    // Z 셋이 차례로 떠오르며 커졌다 사라진다
    for (let i = 0; i < 3; i++) {
      const u = (t / 2700 + i / 3) % 1;
      glyph('Z', FX_X + 4 - u * 16, FX_Y + 14 - u * 32, 11 + u * 10, INK, '#fff', Math.sin(Math.PI * u), -0.2);
    }
  } else if (fx === 'hearts') {
    // 하트 셋이 0.3초 간격으로 흔들리며 떠오른다
    for (let i = 0; i < 3; i++) {
      if (t < i * 300) continue;
      const u = ((t - i * 300) % 1000) / 1000;
      heart(FX_X - 8 + i * 6 + 3 * Math.sin(u * 6), FX_Y + 26 - u * 34, 0.8 + 0.4 * u, Math.sin(Math.PI * u) * kf(t, [[d - 250, 1], [d, 0]]));
    }
  }
}

function drawCat(now) {
  const state = effectiveState();
  if (state !== lastState) {
    lastState = state;
    stateStart = now;
    fade = shown && { ...shown, start: now };
  }

  // idle 로 가만히 있으면 가끔 두리번(갸웃)/빼꼼
  // (앱을 켜자마자 첫 프레임에 걸리지 않게, 처음 한 번은 시간을 벌어둔다)
  if (state !== 'idle' || nextQuirk < 0) {
    nextQuirk = now + TIME.QUIRK_AFTER_MS;
  } else if (now > nextQuirk) {
    setTemp(Math.random() < 0.6 ? 'curious' : 'peek');
    nextQuirk = now + TIME.QUIRK_MIN_MS + Math.random() * TIME.QUIRK_SPREAD_MS;
  }

  const a = ANIM[state] || ANIM.idle;
  const t = now - stateStart;
  let idx = Math.floor((t / 1000) * a.fps);
  idx = a.loop ? idx % a.frames.length : Math.min(idx, a.frames.length - 1);
  const name = a.frames[idx];
  const img = sticker(name);
  if (!img) return;
  const d = temp ? temp.until - stateStart : Infinity;
  const p = reduceMotion.matches ? REST : pose(a, t, d); // 모션 최소화: 표정·이펙트만 바꾼다
  if (fade && (fade.name === name || now - fade.start >= FADE_MS)) fade = null;

  // 결과가 직전과 같으면 캔버스를 건드리지 않는다 — 숨쉬기는 몇 프레임씩 같은 그림이라
  // 매번 다시 그리면 렌더러와 GPU 합성이 쉬지 못한다. (기기 픽셀 단위로 비교)
  const px = (v) => Math.round(v * SCALE);
  const sig = [name, px(p.x), px(p.y), px(p.sx * CHAR_H), px(p.sy * CHAR_H), px(p.r * CHAR_H), a.fx || fade ? now : 0].join('|');
  if (sig === lastSig) return;
  lastSig = sig;

  ctx.clearRect(0, 0, LW, LH);
  shown = { name, img, p };
  drawSticker(shown, 1, a.motion === 'peek');
  if (fade) drawSticker(fade, 1 - (now - fade.start) / FADE_MS, false);
  if (a.fx) drawFx(a.fx, t, d);
}

// ===========================================================================
// 알림 말풍선 — SVG 모양 + 픽셀 폰트, 제목은 쓴 그대로 (이모지는 문구에 직접)
// ===========================================================================
let bubbleTimer = null;

function showBubble({ title, message, level, duration, react = true, reaction }) {
  // D-day 클릭 팝업이 떠 있으면 먼저 빠르게 닫고, 사라진 뒤 상태메시지 표시
  if (clickBubble && !clickBubble.classList.contains('hidden')) {
    clickBubble.classList.add('closing');
    setTimeout(() => {
      clickBubble.classList.add('hidden');
      clickBubble.classList.remove('closing');
      showBubble({ title, message, level, duration, react, reaction });
    }, TIME.BUBBLE_CLOSE_MS);
    return;
  }

  syncBubbleClass(level || 'info');
  bTitle.textContent = title || '알림';
  bMsg.textContent = message || '';
  bMsg.style.display = message ? 'block' : 'none';
  sizeBubble(); // 텍스트 길이에 맞춰 중앙 컬럼 스트레치
  bubble.classList.remove('hidden');
  // 리플로우로 애니메이션 재시작
  void bubble.offsetWidth;

  if (bubbleTimer) clearTimeout(bubbleTimer);
  const dur = duration || (level === 'urgent' ? TIME.BUBBLE_URGENT_MS : TIME.BUBBLE_MS);
  bubbleTimer = setTimeout(hideBubble, dur);

  // 캐릭터 반응 — 성공/정보는 놀람→신남, 실패/경고는 계속 놀람 유지
  // (클릭 대화 버블은 이미 인사 중이라 react:false 로 건너뜀)
  if (react) {
    setTemp('notify', TIME.REACT_DELAY_MS);
    if (reaction && ANIM[reaction]) {
      // 보낸 쪽이 표정을 지정한 경우 (Web Vitals 결과 등)
      setTimeout(() => setTemp(reaction, TIME.REACT_CUSTOM_MS), TIME.REACT_DELAY_MS);
    } else if (level === 'urgent' || level === 'warn') {
      setTimeout(() => setTemp('notify', TIME.REACT_HOLD_MS), TIME.REACT_DELAY_MS);
    } else {
      setTimeout(() => setTemp('happy', TIME.REACT_HAPPY_MS), TIME.REACT_DELAY_MS);
    }
  }
  releaseMouseIfIdle(); // 직전 팝업을 닫으며 잡은 마우스가 남아있으면 정리
}
function hideBubble() {
  // 클릭으로 먼저 닫으면 예약된 자동 숨김이 남아 엉뚱한 때에 다시 돈다
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
  bubble.classList.add('hidden');
  releaseMouseIfIdle();
}
bubble.addEventListener('click', hideBubble);

// ===========================================================================
// 메인 프로세스 이벤트 연결
// ===========================================================================
if (window.mascot) {
  window.mascot.onNotify((d) => showBubble(d));
  window.mascot.onState(({ state, ttl, dir }) => {
    if (dir != null) walkDir = dir;
    if (!ttl && BASE_STATES.includes(state)) {
      const prev = baseState;
      baseState = state;
      if (prev === 'sleeping' && state !== 'sleeping') wakeThen(); // 깨어나는 연출
    } else if (ANIM[state]) {
      if (baseState === 'sleeping') {
        baseState = 'idle';
        wakeThen(() => setTemp(state, ttl));
      } else {
        setTemp(state, ttl);
      }
    }
  });
  window.mascot.onDnd(({ dnd }) => {
    dndBadge.classList.toggle('hidden', !dnd);
  });
}

// ===========================================================================
// 클릭 팝업 — 말풍선 안에 D-day (창 안 오버레이)
// ===========================================================================
const clickBubble = document.getElementById('click-bubble');
const cbDday = document.getElementById('cb-dday');
const cbClose = document.getElementById('cb-close');

function hideClickBubble() {
  clickBubble.classList.add('hidden');
  releaseMouseIfIdle();
}

if (cbClose) {
  cbClose.addEventListener('click', (e) => {
    e.stopPropagation();
    hideClickBubble();
  });
}

// "종강까지 D-75" / 당일 "종강 D-DAY" / 이후 "종강 D+3"
// 라벨·날짜는 shared/conference.js 의 shortName·startDate 에서 가져온다.
function setDdayContent(conf, now) {
  const s = conf.startDate;
  if (!s) {
    cbDday.textContent = '';
    return;
  }
  const label = conf.shortName || '행사';
  const diff = TIME.daysUntil(now, s);
  const num = document.createElement('span');
  num.className = 'dday-num';
  num.textContent = diff > 0 ? `D-${diff}` : diff === 0 ? 'D-DAY' : `D+${-diff}`;
  cbDday.textContent = diff > 0 ? `${label}까지 ` : `${label} `;
  cbDday.appendChild(num);
}
async function toggleClickBubble() {
  if (!clickBubble.classList.contains('hidden')) {
    hideClickBubble();
    return;
  }
  hideBubble(); // 대화 버블이 떠 있으면 안내창과 겹치지 않게 정리
  let data = { conference: {}, now: Date.now() };
  if (window.mascot && window.mascot.guideGetData) {
    try {
      const d = await window.mascot.guideGetData();
      if (d) data = d;
    } catch (_) {}
  }
  setDdayContent(data.conference || {}, data.now || Date.now());
  clickBubble.classList.remove('hidden');
  void clickBubble.offsetWidth; // pop 애니메이션 재생
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideClickBubble();
});

// ===========================================================================
// 클릭 통과 (투명 영역)
// ===========================================================================
// 창은 넓지만 실제 캐릭터/말풍선은 일부뿐 — 그 위에 커서가 있을 때만 마우스를
// 잡고, 나머지 투명 영역은 아래 앱으로 클릭을 통과시킨다.
// (메인 프로세스가 forward:true 로 mousemove 를 계속 보내줘서 hover 감지 가능)
let dragging = false;

function setIgnoreMouse(ignore) {
  if (window.mascot && window.mascot.setIgnoreMouse) {
    window.mascot.setIgnoreMouse(ignore);
  }
}
const INTERACTIVE = [cv, bubble, clickBubble];
function overInteractive() {
  return INTERACTIVE.some((el) => el.matches(':hover'));
}
// 버블이 display:none 으로 사라질 땐 mouseleave 가 발화하지 않아 창이 계속
// 마우스를 잡고 있게 된다 — 숨긴 직후 커서 아래 잡을 게 없으면 놓아준다
function releaseMouseIfIdle() {
  if (!dragging && !overInteractive()) setIgnoreMouse(true);
}
for (const el of INTERACTIVE) {
  el.addEventListener('mouseenter', () => setIgnoreMouse(false));
  el.addEventListener('mouseleave', () => {
    // 드래그 중 커서가 잠깐 벗어나도 창을 놓치지 않도록 유지
    if (!dragging && !overInteractive()) setIgnoreMouse(true);
  });
}
setIgnoreMouse(true);

// ===========================================================================
// 드래그 이동 & 클릭
// ===========================================================================
let moved = 0;
let last = { x: 0, y: 0 };

cv.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; // 왼쪽 버튼만 드래그/클릭 처리
  dragging = true;
  moved = 0;
  last = { x: e.screenX, y: e.screenY };
  if (window.mascot && window.mascot.dragStart) window.mascot.dragStart();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - last.x;
  const dy = e.screenY - last.y;
  moved += Math.abs(dx) + Math.abs(dy);
  last = { x: e.screenX, y: e.screenY };
  if (window.mascot) window.mascot.drag(dx, dy);
});
// 원클릭 → 대화 버블 (3초 뒤 사라짐) / 더블클릭 → D-day 팝업
// 이름은 바뀔 수 있어 조사(야/이야)가 붙지 않게 쓴다
const CHAT_LINES = [
  `안녕, 난 ${BRAND.NAME}! 👋`,
  `오늘도 ${BRAND.ORG} 화이팅 💚`,
  '오늘 잔디는 심었어? 🌱',
  '막히면 잠깐 쉬어가도 괜찮아 ☕️',
  '두 번 클릭하면 D-day 를 보여줄게!',
];
let clickTimer = null;

function showChatBubble() {
  const line = CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)];
  showBubble({ title: line, level: 'info', duration: TIME.CHAT_BUBBLE_MS, react: false });
}

window.addEventListener('mouseup', () => {
  if (dragging && moved < 4) {
    // 클릭 → 자고 있으면 깨우고, 아니면 인사
    if (baseState === 'sleeping') {
      baseState = 'idle';
      wakeThen(() => setTemp('greet'));
    } else {
      setTemp('greet');
    }
    if (clickTimer) {
      // 두 번째 클릭 → 대화 버블 예약 취소하고 D-day 팝업
      clearTimeout(clickTimer);
      clickTimer = null;
      toggleClickBubble();
    } else {
      // 잠시 기다렸다 두 번째 클릭이 없으면 대화 버블
      clickTimer = setTimeout(() => {
        clickTimer = null;
        showChatBubble();
      }, TIME.DBLCLICK_MS);
    }
    if (window.mascot) window.mascot.click();
  }
  dragging = false;
  // 드래그가 끝났을 때 커서가 캐릭터 밖이면 다시 클릭 통과로
  if (!overInteractive()) setIgnoreMouse(true);
});

// ===========================================================================
// 애니메이션 루프
// ===========================================================================
// 항상 떠 있는 창이라 브라우저가 rAF 를 줄여주지 않아 120Hz 화면에서는 초당 120번
// 깨어난다. 필요한 만큼만 타이머로 깨운다 — 숨쉬기처럼 느린 모션은 더 드물게.
function drawInterval() {
  const a = ANIM[effectiveState()] || ANIM.idle;
  const calm = !fade && (a.motion === 'breathe' || a.motion === 'sleep');
  return TIME.SEC / (calm ? Math.max(TIME.DRAW_FPS_MIN, a.fps) : TIME.DRAW_FPS_CAP);
}

function tick() {
  if (!document.hidden) drawCat(performance.now()); // 숨겨둔 동안은 그리지 않는다
  setTimeout(tick, drawInterval());
}
tick();

// 창은 말풍선 자리까지 포함해 캐릭터보다 한참 크다 — 화면 경계를 창이 아니라 캐릭터
// 기준으로 잡을 수 있도록, 캔버스가 창 안 어디에 놓였는지 메인에 알려준다.
function reportCharBox() {
  if (!window.mascot || !window.mascot.setCharBox) return;
  const r = cv.getBoundingClientRect();
  window.mascot.setCharBox({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
}
window.addEventListener('load', reportCharBox);
reportCharBox();

// 숨긴 창의 타이머는 브라우저가 초당 1회로 늦춘다 — 다시 보일 때 곧바로 따라잡는다
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) drawCat(performance.now());
});
