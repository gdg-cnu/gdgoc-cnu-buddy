'use strict';

// Web Vitals 피드백 — dev 서버에서 띄운 페이지의 실측 지표에 마스코트가 반응한다
// 임계값은 web.dev 의 Core Web Vitals 기준. good 이하 / poor 초과 사이가 '개선 필요'.

const VITALS = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};
const VITAL_ORDER = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];
const GRADE_RANK = { good: 0, ni: 1, poor: 2 };

function formatVital(name, value) {
  if (name === 'CLS') return value.toFixed(3);
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function gradeVitals(metrics = {}) {
  const graded = [];
  for (const name of VITAL_ORDER) {
    const raw = metrics[name] != null ? metrics[name] : metrics[name.toLowerCase()];
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) continue;
    const t = VITALS[name];
    graded.push({
      name,
      value,
      grade: value <= t.good ? 'good' : value > t.poor ? 'poor' : 'ni',
    });
  }
  return graded;
}

function createVitalsHandler({ TIME, getDnd, scheduleSleep, sendToMascot }) {
  let lastVitalsGrade = null;
  let lastVitalsAt = 0;

  return function handleVitals(payload = {}) {
    const metrics = payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : payload;
    const graded = gradeVitals(metrics);
    if (!graded.length) return { ok: false, error: 'no known metrics' };

    const worst = graded.reduce((a, b) => (GRADE_RANK[b.grade] > GRADE_RANK[a.grade] ? b : a));
    const overall = worst.grade;
    const summary = graded.map((g) => `${g.name} ${formatVital(g.name, g.value)}`).join(' · ');
    console.log(`[vitals] ${overall} — ${summary}${payload.url ? ` (${payload.url})` : ''}`);

    if (getDnd()) return { ok: true, grade: overall, summary, skipped: 'dnd' };

    const changed = overall !== lastVitalsGrade;
    const worse = !lastVitalsGrade || GRADE_RANK[overall] > GRADE_RANK[lastVitalsGrade];
    const minGap = worse
      ? TIME.VITALS_GAP_WORSE_MS
      : changed
        ? TIME.VITALS_GAP_CHANGED_MS
        : TIME.VITALS_GAP_SAME_MS;
    if (Date.now() - lastVitalsAt < minGap) {
      return { ok: true, grade: overall, summary, skipped: 'throttled' };
    }
    lastVitalsGrade = overall;
    lastVitalsAt = Date.now();

    const where = payload.url && payload.url !== '/' ? String(payload.url).slice(0, 40) : '';
    let title;
    let message;
    let level;
    let reaction;
    if (overall === 'good') {
      title = '💯 Web Vitals 완벽!';
      message = summary;
      level = 'success';
      reaction = 'love';
    } else {
      const others = graded.filter((g) => g.grade !== 'good' && g !== worst).length;
      const limit = formatVital(worst.name, VITALS[worst.name].good);
      title = overall === 'poor' ? '🐢 많이 느려졌어요' : '🤔 조금 아쉬워요';
      message =
        `${worst.name} ${formatVital(worst.name, worst.value)} · 기준 ${limit} 이하` +
        (others ? ` 외 ${others}개` : '') +
        (where ? ` · ${where}` : '');
      level = overall === 'poor' ? 'warn' : 'info';
      reaction = 'curious';
    }

    scheduleSleep();
    sendToMascot('mascot:notify', { title, message, level, reaction });
    return { ok: true, grade: overall, summary };
  };
}

module.exports = { VITALS, createVitalsHandler, gradeVitals };
