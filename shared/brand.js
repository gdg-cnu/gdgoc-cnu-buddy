'use strict';

// ===========================================================================
// 브랜드 상수 — 마스코트 이름·동아리 이름·링크는 여기서만 정한다.
// 이름이 정해지면 NAME 한 줄만 바꾸면 말풍선·트레이·안내창이 모두 따라온다.
//
// shared/time.js 와 같은 방식으로 두 군데서 읽힌다.
//   main.js, lib/*  →  const BRAND = require('./shared/brand');
//   renderer/*.html →  <script src="../shared/brand.js"></script>  뒤에 전역 BRAND
// ===========================================================================

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BRAND = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const SITE_URL = 'https://ppre1ude.github.io/gdgoc-keroro-deploy/';
  return {
    NAME: '지디', // 임시 이름 — 디자이너와 정하면 여기만 바꾼다
    ORG: 'GDGoC CNU',
    SITE_URL, // 팀 모집 사이트
    GRASS_URL: SITE_URL + 'grass.html', // 잔디 심기 챌린지
  };
});
