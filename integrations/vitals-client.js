// ===========================================================================
// vitals-client — 브라우저에서 Core Web Vitals 를 재서 마스코트로 보낸다
//
// 페이지에 끼워 넣는 방법은 두 가지다. vite-plugin-mascot 이 dev 서버에서 내려주거나,
// mascot-dev 프록시가 마스코트 앱의 주소를 가리키는 <script> 를 HTML 에 넣어준다.
// 어느 쪽이든 빌드 결과물에는 절대 들어가지 않는다.
//
// 라이브러리 없이 PerformanceObserver 만 쓴다 — 사용자 프로젝트에 의존성을
// 추가하지 않기 위해서다. 임계값 판정은 마스코트 앱(main.js)이 담당한다.
// ===========================================================================
(function () {
  'use strict';

  if (typeof PerformanceObserver === 'undefined') return;
  if (window.__mascotVitals) return; // HMR 로 두 번 실행되는 경우 방지

  var metrics = {};
  // 콘솔에서 window.__mascotVitals 로 잡힌 값과 보낼 주소를 확인할 수 있다
  window.__mascotVitals = { metrics: metrics };

  // 스크립트를 어디서 받아왔는지가 보낼 곳을 정한다. dev 서버가 내려줬다면 그 서버가
  // 중계하므로 상대 경로로, 마스코트 앱에서 바로 받아왔다면 그 앱으로 곧장 보낸다.
  // sendBeacon 은 커스텀 헤더를 못 넣으니 token 은 스크립트 URL 의 ?token= 을 그대로 붙인다.
  var ENDPOINT = '/__mascot/vitals';
  try {
    var src = document.currentScript && document.currentScript.src;
    if (src) {
      var scriptUrl = new URL(src, location.href);
      if (scriptUrl.origin !== location.origin) {
        ENDPOINT = scriptUrl.origin + '/vitals';
        var tok = scriptUrl.searchParams.get('token');
        if (tok) ENDPOINT += '?token=' + encodeURIComponent(tok);
      }
    }
  } catch (_) {}
  window.__mascotVitals.endpoint = ENDPOINT;

  var SETTLE_MS = 2500; // 지표가 잠잠해지길 기다리는 시간
  // 첫 보고만 더 기다린다. LCP 는 늦게 그려지는 이미지·폰트·지연 렌더링 때문에 한참 뒤에
  // 확정되는 일이 흔해서, 서둘러 보내면 아직 그리는 중인 페이지를 '완벽'이라고 알린다.
  var FIRST_SETTLE_MS = 5000;
  var MIN_INTERVAL_MS = 10000; // 연속 전송 최소 간격

  var dirty = false;
  var timer = null;
  var timerAt = 0; // 예약해 둔 발사 시각
  var lastSentAt = 0;

  function set(name, value) {
    if (typeof value !== 'number' || !isFinite(value) || value < 0) return;
    if (metrics[name] === value) return;
    // 모든 지표는 낮을수록 좋다. 값이 나빠졌다면 앞서 보낸 판정이 틀렸다는 뜻이라
    // 최소 간격을 기다리지 않고 서둘러 바로잡는다.
    var worse = metrics[name] != null && value > metrics[name];
    metrics[name] = value;
    dirty = true;
    schedule(worse);
  }

  // LCP·CLS·INP 는 페이지가 살아있는 내내 갱신된다. 바뀔 때마다 보내면
  // 마스코트가 쉴 새 없이 말을 걸어서, 잠잠해진 뒤 한 번에 모아 보낸다.
  function schedule(urgent) {
    var settle = lastSentAt ? SETTLE_MS : FIRST_SETTLE_MS;
    var wait = urgent ? settle : Math.max(settle, MIN_INTERVAL_MS - (Date.now() - lastSentAt));
    var at = Date.now() + wait;
    if (timer && timerAt <= at) return; // 이미 더 이르게 잡혀 있다
    clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(function () {
      timer = null;
      flush();
    }, wait);
  }

  function flush(force) {
    if (!dirty) return;
    // LCP 없이 보내면 아직 그리는 중인 페이지가 '완벽'으로 판정된다.
    // 탭을 닫을 때(force)도 LCP 가 없으면 보내지 않는다.
    if (!('LCP' in metrics)) {
      if (!force) return schedule();
      return;
    }
    if (!force && document.readyState !== 'complete') {
      return schedule();
    }
    dirty = false;
    lastSentAt = Date.now();
    var body = JSON.stringify({ url: location.pathname, metrics: metrics });
    try {
      if (navigator.sendBeacon) {
        // text/plain 으로 보낸다 — sendBeacon 은 언제나 credentials 를 싣기 때문에
        // application/json 이면 사전 요청(preflight)이 걸려 다른 출처로는 막힌다.
        // 받는 쪽은 Content-Type 을 보지 않고 본문을 JSON 으로 읽는다.
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
      } else {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
        });
      }
    } catch (_) {
      // 측정이 페이지를 방해하면 본말전도다 — 실패는 조용히 넘긴다
    }
  }

  function observe(type, cb, extra) {
    try {
      var opts = { type: type, buffered: true };
      if (extra) for (var k in extra) opts[k] = extra[k];
      var po = new PerformanceObserver(function (list) {
        cb(list.getEntries());
      });
      po.observe(opts);
    } catch (_) {
      // 지원하지 않는 지표는 건너뛴다 (브라우저마다 다름)
    }
  }

  // TTFB — 서버가 첫 바이트를 뱉기까지
  observe('navigation', function (entries) {
    var e = entries[entries.length - 1];
    if (e) set('TTFB', e.responseStart);
  });

  // FCP — 첫 콘텐츠가 그려지기까지
  observe('paint', function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].name === 'first-contentful-paint') set('FCP', entries[i].startTime);
    }
  });

  // LCP — 가장 마지막 후보가 최종값이다
  observe('largest-contentful-paint', function (entries) {
    var e = entries[entries.length - 1];
    if (e) set('LCP', e.startTime);
  });

  // CLS — 5초 윈도우·1초 간격으로 끊은 세션 중 최댓값 (web.dev 정의)
  var cls = 0;
  var sessionValue = 0;
  var sessionFirst = 0;
  var sessionLast = 0;
  set('CLS', 0); // 흔들림이 없었다는 것도 보고할 가치가 있는 결과다
  observe('layout-shift', function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.hadRecentInput) continue; // 사용자가 만든 변화는 제외
      if (sessionValue && e.startTime - sessionLast < 1000 && e.startTime - sessionFirst < 5000) {
        sessionValue += e.value;
        sessionLast = e.startTime;
      } else {
        sessionValue = e.value;
        sessionFirst = e.startTime;
        sessionLast = e.startTime;
      }
      if (sessionValue > cls) {
        cls = sessionValue;
        set('CLS', Math.round(cls * 1000) / 1000);
      }
    }
  });

  // INP 근사 — 정식 INP 는 상호작용 분포의 상위 백분위지만,
  // 로컬에서 "어디가 굼뜬가"를 보려면 가장 느렸던 상호작용이 더 유용하다.
  var worstInp = 0;
  observe(
    'event',
    function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e.interactionId) continue;
        if (e.duration > worstInp) {
          worstInp = e.duration;
          set('INP', Math.round(worstInp));
        }
      }
    },
    { durationThreshold: 40 }
  );

  // 탭을 떠나면 대기 중인 값을 마저 보낸다
  addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
  });
  addEventListener('pagehide', function () {
    flush(true);
  });
})();
