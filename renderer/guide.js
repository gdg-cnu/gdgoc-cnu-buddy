'use strict';

// 학기 안내 — 학기 중 / 종강일 / 방학 3가지 상태

const contentEl = document.getElementById('content');
const clockEl = document.getElementById('clock');
const titleEl = document.getElementById('title');
const subtitleEl = document.getElementById('subtitle');
const footerEl = document.getElementById('footer-text');

let data = { items: [], conference: {}, phase: null };

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const { pad, hhmm, startOfDay } = TIME; // shared/time.js

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---- SVG 아이콘 (Lucide 스타일 stroke) ----
const ICONS = {
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  sprout:
    '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>',
  arrow: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>',
};
function iconEl(name, cls) {
  const span = el('span', cls);
  span.innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

function fmtDate(ds) {
  const t = startOfDay(ds);
  if (isNaN(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${WD[d.getDay()]})`;
}
function dateRange(conf) {
  const s = conf.startDate;
  const e = conf.endDate || s;
  if (!s) return '';
  if (startOfDay(s) === startOfDay(e)) return fmtDate(s);
  return `${fmtDate(s)} ~ ${fmtDate(e)}`;
}
function fmtEta(ms) {
  const min = Math.round(ms / TIME.MIN);
  if (min <= 0) return '지금';
  if (min < 60) return `${min}분 후`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분 후` : `${h}시간 후`;
}
function statusOf(item, now) {
  const t = new Date(item.time).getTime();
  const lead = (item.leadMinutes != null ? item.leadMinutes : TIME.DEFAULT_LEAD_MIN) * TIME.MIN;
  if (now >= t) return { key: 'done', label: '종료' };
  if (now >= t - lead) return { key: 'soon', label: '곧 시작' };
  if (now >= t - TIME.SESSION_UPCOMING_MS) return { key: 'upcoming', label: '예정' };
  return { key: 'scheduled', label: '예정' };
}

function openLink(url) {
  if (url && window.mascot && window.mascot.openExternal) window.mascot.openExternal(url);
}

function hero(label, big, sub) {
  const h = el('div', 'hero');
  h.appendChild(el('div', 'hero-label', label));
  h.appendChild(el('div', 'hero-dday', big));
  if (sub) h.appendChild(el('div', 'hero-sub', sub));
  contentEl.appendChild(h);
}

// 학기 내내 같은 두 링크 (주소는 shared/brand.js)
const LINKS = [
  {
    cls: 'site',
    icon: 'users',
    title: '팀 모집 사이트',
    sub: '이번 학기 프로젝트 팀을 둘러봐요',
    url: BRAND.SITE_URL,
  },
  {
    cls: 'grass',
    icon: 'sprout',
    title: '잔디 심기 챌린지',
    sub: '오늘도 커밋 한 칸 채워요 🌱',
    url: BRAND.GRASS_URL,
  },
];
function linkCards() {
  for (const l of LINKS) {
    const card = el('button', 'link-card ' + l.cls);
    card.appendChild(iconEl(l.icon, 'lc-icon'));
    const body = el('div', 'lc-body');
    body.appendChild(el('div', 'lc-title', l.title));
    body.appendChild(el('div', 'lc-sub', l.sub));
    card.appendChild(body);
    card.appendChild(iconEl('arrow', 'lc-arrow'));
    card.addEventListener('click', () => openLink(l.url));
    contentEl.appendChild(card);
  }
}

// -------------------- 학기 중 --------------------
function renderBefore(conf) {
  subtitleEl.textContent = '학기 중';
  footerEl.textContent = `${BRAND.NAME}도 ${conf.shortName}까지 같이 달릴게요 💪`;

  hero(`${conf.shortName}까지`, `D-${TIME.daysUntil(Date.now(), conf.startDate)}`, dateRange(conf));

  if (data.items && data.items.length) {
    contentEl.appendChild(
      el('div', 'session-count', `총 ${data.items.length}개 세션이 준비되고 있어요`)
    );
  }
}

// -------------------- 종강일 --------------------
function renderDayof(conf) {
  subtitleEl.textContent = `${conf.shortName}일`;
  footerEl.textContent = `${BRAND.ORG}와 함께한 한 학기, 고마워요 🙏`;

  hero('오늘은', `${conf.shortName}!`, '이번 학기도 수고했어요 🎉');

  // 세션이 없는 평범한 종강일엔 목록 자리를 아예 그리지 않는다
  const items = [...(data.items || [])].sort((a, b) => new Date(a.time) - new Date(b.time));
  if (!items.length) return;

  const now = Date.now();
  const next = items.find((it) => new Date(it.time).getTime() > now);
  if (next) {
    const banner = el('div', 'next-banner');
    banner.appendChild(el('span', 'dot'));
    const b = el('div');
    b.appendChild(el('div', 'nb-label', '다음 세션'));
    b.appendChild(el('div', 'nb-title', next.title || '다음 세션'));
    banner.appendChild(b);
    banner.appendChild(el('span', 'nb-eta', fmtEta(new Date(next.time).getTime() - now)));
    contentEl.appendChild(banner);
  }

  const list = el('ul', 'list');
  for (const it of items) {
    const st = statusOf(it, now);
    const li = el('li', 'item ' + (st.key === 'soon' ? 'soon' : st.key === 'done' ? 'done' : ''));
    li.appendChild(el('div', 'time', hhmm(new Date(it.time).getTime())));
    const body = el('div', 'body');
    body.appendChild(el('div', 't-title', it.title || '세션'));
    if (it.message) body.appendChild(el('div', 't-msg', it.message));
    li.appendChild(body);
    li.appendChild(el('span', 'badge ' + st.key, st.label));
    list.appendChild(li);
  }
  contentEl.appendChild(list);
}

// -------------------- 방학 --------------------
function renderAfter(conf) {
  subtitleEl.textContent = '방학 중';
  footerEl.textContent = `${BRAND.NAME}도 방학 동안 푹 쉴게요 😴`;

  const n = TIME.daysUntil(conf.endDate || conf.startDate, Date.now());
  hero('방학', `D+${n}`, '다음 학기에 또 만나요 👋');
}

// -------------------- 렌더 디스패치 --------------------
function render() {
  const conf = { shortName: '행사', ...data.conference }; // 이름이 빠져도 D-day 팝업과 같은 말을 쓴다
  titleEl.textContent = data.title || '학기 안내';
  contentEl.innerHTML = '';
  contentEl.className = 'phase-' + (data.phase || 'dayof');
  subtitleEl.textContent = '';
  footerEl.textContent = '';

  if (data.phase === 'before') renderBefore(conf);
  else if (data.phase === 'after') renderAfter(conf);
  else if (data.phase === 'dayof') renderDayof(conf); // null(날짜를 못 읽음)이면 링크만 남긴다
  if (data.subtitle) subtitleEl.textContent = data.subtitle; // config.json 의 guideSubtitle
  linkCards();

  tickClock();
}

function tickClock() {
  const d = new Date();
  clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function refresh() {
  if (window.mascot && window.mascot.guideGetData) {
    try {
      const d = await window.mascot.guideGetData();
      if (d) data = d;
    } catch (_) {}
  }
  render();
}

document.getElementById('close').addEventListener('click', () => {
  if (window.mascot && window.mascot.guideClose) window.mascot.guideClose();
});

// 헤더를 잡고 패널을 옮긴다. 창이 따라 움직여도 어긋나지 않도록 화면 좌표의 변화량을
// 보낸다 — 화면 경계에서 더 나가지 않게 막는 일은 메인 프로세스가 한다.
if (window.bindPanelDrag && window.mascot && window.mascot.guideDrag) {
  window.bindPanelDrag(document.querySelector('header'), {
    ignore: '#close',
    onStart: () => window.mascot.guideDragStart(),
    onMove: (dx, dy) => window.mascot.guideDrag(dx, dy),
  });
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && window.mascot && window.mascot.guideClose) window.mascot.guideClose();
});

if (window.mascot && window.mascot.onGuideData) {
  window.mascot.onGuideData((d) => {
    if (d) data = d;
    render();
  });
}

refresh();
// 패널은 대부분 숨겨져 있다 — 보이지 않는 동안 DOM 을 다시 그릴 이유가 없다
setInterval(() => {
  if (!document.hidden) tickClock();
}, TIME.GUIDE_CLOCK_MS);
setInterval(() => {
  if (!document.hidden) render();
}, TIME.GUIDE_RENDER_MS);
