'use strict';

// ===========================================================================
// 시간·날짜 공용 값 — 메인 프로세스와 렌더러 창이 모두 같은 값을 본다.
//
// 렌더러는 contextIsolation 때문에 require 를 쓸 수 없다. 그래서 어떻게 읽히든
// 같은 객체를 내주도록 두 방식을 모두 지원한다.
//   main.js         →  const TIME = require('./shared/time');
//   renderer/*.html →  <script src="../shared/time.js"></script>  뒤에 전역 TIME
//
// 행사 날짜·세션 시각은 여기가 아니라 shared/conference.js 에 있다.
// 이 파일은 "앱이 얼마나 기다리는가"만 다룬다.
// ===========================================================================

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TIME = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  // ---- 마스코트 걸음 ----
  const WALK_TICK_MS = 33; // ~30fps
  const WANDER_STEP_MS = 600; // 한 걸음을 걷는 시간
  const WANDER_GAP_MS = 1670; // 걸음 시작 간격 — 3걸음이 약 5초
  const WANDER_MIN_MS = 25 * SEC; // 다음 산책까지 대기(최소~최대)
  const WANDER_MAX_MS = 50 * SEC;
  const WALK_LINGER_MS = 6 * SEC; // 작업 끝나고 제자리로 돌아가기 전 머무는 시간

  // ---- 창 살림 ----
  const HIDDEN_DESTROY_MS = 5 * MIN; // 숨긴 창을 이만큼 안 쓰면 정리해서 메모리를 돌려준다
  const HIDDEN_SWEEP_MS = 30 * SEC; // 숨긴 창을 살펴보는 간격

  // ---- 알림 ----
  const NOTIFICATION_RELEASE_MS = 60 * SEC; // close 이벤트가 안 와도 이때는 놓아준다
  const FIRST_GREET_MS = 800; // 앱이 뜨고 첫 인사까지
  const HELP_FIRST_SHOW_MS = 1600; // 첫 실행에서 사용 안내가 뜨기까지 (인사를 본 뒤)
  const CONF_RELOAD_MS = 250; // 행사 정보 파일이 저장된 뒤 다시 읽기까지 (연속 저장 대비)
  const DEFAULT_LEAD_MIN = 5; // 세션 알림을 몇 분 전에 띄울지 (leadMinutes 기본값)
  const SESSION_UPCOMING_MS = 30 * MIN; // 안내 패널에서 세션이 "예정"으로 눈에 띄는 구간
  const MAX_TIMEOUT_MS = 2147483647; // setTimeout 한 번에 맡길 수 있는 최대치(약 24.8일)

  // ---- 말풍선 ----
  const BUBBLE_MS = 6500; // 알림 말풍선이 머무는 시간
  const BUBBLE_URGENT_MS = 12 * SEC; // urgent 는 좀 더 오래
  const BUBBLE_CLOSE_MS = 160; // 사라지는 애니메이션
  const CHAT_BUBBLE_MS = 3 * SEC; // 클릭 인사 말풍선

  // ---- 표정 ----
  const REACT_DELAY_MS = 1600; // 놀란 표정에서 본 반응으로 넘어가기까지
  const REACT_HOLD_MS = 2800; // notify 표정 유지
  const REACT_HAPPY_MS = 1800;
  const REACT_CUSTOM_MS = 3 * SEC; // /notify 의 reaction 으로 지정한 표정
  const TEMP_LOOP_MS = 3 * SEC; // 무한 반복 애니메이션을 잘라내는 시간

  // ---- 심심할 때 ----
  const QUIRK_AFTER_MS = 8 * SEC; // 가만히 둔 뒤 첫 딴짓까지
  const QUIRK_MIN_MS = 9 * SEC; // 다음 딴짓까지 (최소 + 0~SPREAD)
  const QUIRK_SPREAD_MS = 10 * SEC;

  // ---- 그리기 ----
  const DRAW_FPS_CAP = 30; // 모션 중 — 120Hz 화면에서도 이 이상 깨우지 않는다
  const DRAW_FPS_MIN = 12; // 숨쉬기처럼 느린 모션은 이만큼만 갱신

  // ---- 입력 ----
  const DBLCLICK_MS = 250; // 이 안에 또 누르면 더블클릭

  // ---- Web Vitals ----
  const VITALS_GAP_SAME_MS = 60 * SEC; // 같은 등급이면 이만큼 조용히
  const VITALS_GAP_CHANGED_MS = 6 * SEC; // 등급이 바뀌었으면 이만큼만 참는다
  const VITALS_GAP_WORSE_MS = 1.5 * SEC; // 나빠졌다면 거의 바로 알린다

  // ---- 패널 갱신 ----
  const GUIDE_CLOCK_MS = 1 * SEC; // 안내 패널 시계
  const GUIDE_RENDER_MS = 15 * SEC; // 안내 패널 다시 그리기(세션 뱃지·카운트다운)

  // ---- 날짜 헬퍼 ----
  // 날짜만 비교한다. `YYYY-MM-DD` 는 로컬 자정으로 해석한다
  // (UTC `Date` 파싱은 타임존에 따라 하루가 밀린다).
  function startOfDay(value) {
    if (value == null || value === '') {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    }
    if (typeof value === 'string') {
      const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
      }
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) return NaN;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  // 날짜만 세는 차이 — daysUntil(오늘, 행사일) 이 그대로 D-day 숫자가 된다.
  function daysUntil(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / DAY);
  }
  const pad = (n) => String(n).padStart(2, '0');
  function hhmm(ts) {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  return {
    SEC,
    MIN,
    HOUR,
    DAY,
    WALK_TICK_MS,
    WANDER_STEP_MS,
    WANDER_GAP_MS,
    WANDER_MIN_MS,
    WANDER_MAX_MS,
    WALK_LINGER_MS,
    HIDDEN_DESTROY_MS,
    HIDDEN_SWEEP_MS,
    NOTIFICATION_RELEASE_MS,
    FIRST_GREET_MS,
    HELP_FIRST_SHOW_MS,
    CONF_RELOAD_MS,
    DEFAULT_LEAD_MIN,
    SESSION_UPCOMING_MS,
    MAX_TIMEOUT_MS,
    BUBBLE_MS,
    BUBBLE_URGENT_MS,
    BUBBLE_CLOSE_MS,
    CHAT_BUBBLE_MS,
    REACT_DELAY_MS,
    REACT_HOLD_MS,
    REACT_HAPPY_MS,
    REACT_CUSTOM_MS,
    TEMP_LOOP_MS,
    QUIRK_AFTER_MS,
    QUIRK_MIN_MS,
    QUIRK_SPREAD_MS,
    DRAW_FPS_CAP,
    DRAW_FPS_MIN,
    DBLCLICK_MS,
    VITALS_GAP_SAME_MS,
    VITALS_GAP_CHANGED_MS,
    VITALS_GAP_WORSE_MS,
    GUIDE_CLOCK_MS,
    GUIDE_RENDER_MS,
    startOfDay,
    daysUntil,
    pad,
    hhmm,
  };
});
