'use strict';

// 사용 안내 — 좌우 화살표로 넘기는 몇 장짜리 안내. 처음 실행할 때 저절로 뜨고,
// "다시 보지 않기" 를 켜고 닫으면 다음부터는 트레이 메뉴로만 열린다.

// 마스코트 이름에 조사를 붙일 땐 받침을 따진 BRAND.NAME_TOPIC 처럼 미리 고른 값을 쓴다
const PAGES = [
  {
    emoji: '🤖',
    title: '반가워요, 멤버님!',
    lead: `${BRAND.NAME_TOPIC} ${BRAND.ORG} 마스코트예요. 화면 위에 머물며 작업에 따라 표정이 바뀌어요.`,
    rows: [
      ['클릭', '인사 + 한마디'],
      ['두 번 클릭', '종강 D-day'],
      ['끌기', '원하는 자리로'],
    ],
    note: '학기 안내는 트레이 메뉴에서 열어요.',
  },
  {
    emoji: '📋',
    title: '트레이 메뉴',
    lead: '메뉴 막대·작업 표시줄의 아이콘에서 열어요.',
    rows: [
      ['학기 안내', '학기 일정 한눈에'],
      ['방해 금지', '잠시 조용히'],
      ['잠드는 시간', '1분~30분, 안 잠들기'],
      ['사용 안내', '이 창 다시 보기'],
    ],
  },
  {
    emoji: '⌨️',
    title: '단축키',
    lead: '어느 앱을 쓰고 있든 바로 불러요.',
    rows: [
      ['⌘⇧M / Ctrl+Shift+M', '숨기기 / 보이기'],
      ['⌘⇧H / Ctrl+Shift+H', '인사시키기'],
    ],
  },
  {
    emoji: '🔌',
    title: '프로젝트에 연결하기',
    lead: '빌드·성능 반응을 쓰려면 내 프로젝트 폴더에서 클론한 저장소를 한 번 연결해요.',
    code: 'npm i -D <클론 경로>',
    codeLabel: '연결',
    rows: [
      ['빌드', 'npx gdgoc npm run build'],
      ['dev', 'npx gdgoc npm run dev'],
    ],
    note: '앱은 클론한 폴더에서 npm start 로 켜요.',
  },
  {
    emoji: '🔧',
    title: '빌드·테스트에 반응해요',
    lead: `명령을 감싸면 ${BRAND.NAME} 표정이 바뀌어요.`,
    code: 'npx gdgoc npm run build',
    codeLabel: '명령',
    note: 'npm test 도 같은 방법으로 감싸요.',
  },
  {
    emoji: '💯',
    title: '성능도 봐줘요',
    lead: 'dev 서버를 감싸면 LCP · INP · CLS 를 재서 알려줘요.',
    code: 'npx gdgoc npm run dev',
    codeLabel: '명령',
  },
];

const $ = (id) => document.getElementById(id);
$('subtitle').textContent = `${BRAND.ORG} 마스코트 ${BRAND.NAME}`;
const pageEl = $('page');
const dotsEl = $('dots');
const prevBtn = $('prev');
const nextBtn = $('next');

let idx = 0;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderPage(dir) {
  const p = PAGES[idx];
  pageEl.innerHTML = '';

  const stack = el('div', 'p-stack');

  const hero = el('div', 'p-hero');
  hero.appendChild(el('div', 'p-emoji', p.emoji));
  stack.appendChild(hero);

  stack.appendChild(el('div', 'p-title', p.title));
  if (p.lead) stack.appendChild(el('p', 'p-lead', p.lead));

  if (p.code) {
    const wrap = el('div', 'p-code-wrap');
    wrap.appendChild(el('div', 'p-code-label', p.codeLabel || '명령'));
    wrap.appendChild(el('div', 'p-code', p.code));
    stack.appendChild(wrap);
  }

  if (p.rows && p.rows.length) {
    const ul = el('ul', 'p-list');
    for (const [key, val] of p.rows) {
      const li = el('li', 'p-row');
      li.appendChild(el('span', 'p-key', key));
      li.appendChild(el('span', 'p-val', val));
      ul.appendChild(li);
    }
    stack.appendChild(ul);
  }

  if (p.note) stack.appendChild(el('p', 'p-note', p.note));

  pageEl.appendChild(stack);

  // 넘긴 방향으로 밀려 들어오게
  if (dir) {
    pageEl.style.setProperty('--from', dir > 0 ? '12px' : '-12px');
    pageEl.classList.remove('turn');
    void pageEl.offsetWidth;
    pageEl.classList.add('turn');
  }

  pageEl.scrollTop = 0;
  prevBtn.disabled = idx === 0;
  nextBtn.disabled = idx === PAGES.length - 1;
  syncDots();
}

function syncDots() {
  const dots = dotsEl.children;
  for (let i = 0; i < dots.length; i++) {
    const on = i === idx;
    dots[i].classList.toggle('on', on);
    dots[i].setAttribute('aria-selected', on ? 'true' : 'false');
  }
}

function buildDots() {
  dotsEl.innerHTML = '';
  PAGES.forEach((_, i) => {
    const b = el('button', 'dot');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', `${i + 1}번째 페이지`);
    b.addEventListener('click', () => go(i));
    dotsEl.appendChild(b);
  });
}

function go(next) {
  const target = Math.max(0, Math.min(PAGES.length - 1, next));
  if (target === idx) return;
  const dir = target > idx ? 1 : -1;
  idx = target;
  renderPage(dir);
}

prevBtn.addEventListener('click', () => go(idx - 1));
nextBtn.addEventListener('click', () => go(idx + 1));

function close() {
  if (window.help) window.help.close({ dontShowAgain: $('never-box').checked });
}
$('close').addEventListener('click', close);

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') go(idx + 1);
  else if (e.key === 'ArrowLeft') go(idx - 1);
  else if (e.key === 'Escape') close();
});

// 헤더를 잡고 창 옮기기 — 마스코트·학기 안내와 같은 방식(직접 좌표 이동)
if (window.bindPanelDrag && window.help) {
  window.bindPanelDrag(document.querySelector('header'), {
    ignore: 'button',
    onStart: () => window.help.dragStart(),
    onMove: (dx, dy) => window.help.drag(dx, dy),
  });
}
// 다시 열 때는 늘 첫 장부터
if (window.help && window.help.onShow) {
  window.help.onShow(() => {
    idx = 0;
    renderPage(0);
  });
}

buildDots();
renderPage(0);
