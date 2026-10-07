# 커스터마이징 가이드 — 기본 제공 셋 스펙

이 문서는 캐릭터·앱을 **커스터마이징**할 때 참고하는 **기본 제공 셋 스펙**입니다.
수정 범위는 아트(스티커·말풍선)뿐 아니라 Electron 앱 전체 — 창 동작, 상태 머신, 웹훅, 학기 안내, 트레이 — 입니다. 실행·연동 방법은 [README.md](README.md)를 보세요.

## 기본 제공 셋 한눈에 보기

| 구성 | 내용 | 위치 |
| --- | --- | --- |
| 캐릭터 스티커 | 초록 TV 머리 로봇 PNG 7장 (투명 배경, 높이 240px) | [character/](character/) `gdg-01.png` ~ `gdg-07.png` |
| 모션·이펙트 | 상태별 코드 모션 11종 + `!`·`?`·Z·하트 | [renderer/mascot.js](renderer/mascot.js) `pose` · `drawFx` |
| 말풍선 | CSS 말풍선 2종(gdg 기본 / banner) + JSON 픽셀 말풍선 3종(comic/purple/cozy) + SVG 생각풍선(classic) | [renderer/style.css](renderer/style.css) · [character/](character/) `bubble-*.json` |
| 폰트 | MonaS12(픽셀, 기본) · Pretendard | [renderer/fonts/](renderer/fonts/) |
| 브랜드 | 마스코트 이름 · 동아리 이름 · 팀 모집 사이트 · 잔디 챌린지 링크 | [shared/brand.js](shared/brand.js) |
| 학기 정보 | 종강 날짜 + (행사가 생기면) 세션 목록 | [shared/conference.js](shared/conference.js) |
| 시간 상수 | 잠들기·말풍선 유지·산책 간격 등 "얼마나 기다리는가" 전부 | [shared/time.js](shared/time.js) |
| 앱 본체 | 창/트레이/상태 머신/웹훅 서버 (main) + 렌더링 (renderer) | [main.js](main.js) · [renderer/](renderer/) |

## 앱 구조 맵 — 어디를 고치면 뭐가 바뀌나

| 파일 | 역할 | 이런 커스텀은 여기 |
| --- | --- | --- |
| [main.js](main.js) | 창·트레이·단축키·상태 머신·스케줄러 (오케스트레이션) | 창 크기/위치, 잠들기 시간, 트레이 메뉴, 새 상태 규칙 |
| [lib/](lib/) | `config` · `anims` · `vitals` · `webhook-server` | 설정 기본값, 픽셀 말풍선 JSON 로드, Web Vitals 판정, 웹훅 라우팅 |
| [preload.js](preload.js) | main ↔ renderer IPC 브릿지 | renderer에 새 기능 노출할 때 |
| [renderer/mascot.js](renderer/mascot.js) | 캐릭터·말풍선 렌더링, `ANIM`/`BUBBLE_STYLES` 레지스트리, 코드 모션(`pose`)·이펙트(`drawFx`) | 상태별 스티커·모션, 모션 세기, 말풍선 스타일, 클릭 한마디(`CHAT_LINES`) |
| [renderer/style.css](renderer/style.css) | 마스코트 창 스타일 (말풍선·D-day 팝업 색, 레벨 연출, 폰트) | 말풍선 색, urgent 연출, 새 스타일 테마 |
| [renderer/guide.html](renderer/guide.html) / [guide.js](renderer/guide.js) / [guide.css](renderer/guide.css) | 학기 안내 (학기 중 / 종강일 / 방학 3상태 + 링크 카드) | 스킨, 새 카드/섹션 |
| [renderer/help.html](renderer/help.html) / [help.js](renderer/help.js) / [help.css](renderer/help.css) | 사용 안내 (좌우로 넘기는 카드) | 안내 문구·페이지 추가 (`help.js` 의 `PAGES`) |
| [integrations/](integrations/) | gdgoc · mascot-watch · mascot-dev CLI · Vite 플러그인 · 재사용 클라이언트 | 다른 툴 연동 (webpack, git hook, CI…) |
| [scripts/send.js](scripts/send.js) | 웹훅 CLI 헬퍼 | – |
| [shared/brand.js](shared/brand.js) | 이름·링크 (main 은 `require`, 렌더러는 `<script>` 뒤 전역 `BRAND`) | 마스코트 이름, 링크 주소 |
| [shared/conference.js](shared/conference.js) | 종강 날짜 + 세션 목록 (main 만 읽고 렌더러엔 IPC 로 전달) | 학기 날짜, 세션 추가/수정 |
| [shared/time.js](shared/time.js) | 시간 상수와 날짜 헬퍼 — main 과 렌더러가 같은 값을 본다 | 잠들기·말풍선·딴짓·산책 타이밍, 프레임 상한 |

### 창/동작 스펙 (기본값)

- 마스코트 창 **315×260**, 투명 · 항상 위 · 프레임 없음 · 독/작업표시줄 숨김 · 전체화면 위에도 표시. 빈 영역은 **클릭 통과**(캐릭터/말풍선 위에서만 마우스 활성).
- 캐릭터는 창 좌하단의 **140×140** 캔버스에 키 **96px** 로 그립니다 (`renderer/mascot.js` 의 `LW`·`LH`·`CHAR_H`).
- 위치는 `corner` 설정(`bottom-right` 기본, 4모서리) + 걷기 시 반대 모서리로 왕복.
- 유휴 `idleSleepMs`(기본 5분, 0이면 잠들지 않음) 경과 시 잠들기. 트레이 **잠드는 시간**에서 고른 값은 사용자 폴더의 `ui-state.json`에 저장되고 `config.json`보다 우선합니다. 전역 단축키 `Cmd/Ctrl+Shift+M`(숨김/표시), `Cmd/Ctrl+Shift+H`(인사).
- 이 값들은 `config.json`으로 덮어쓸 수 있어요 (README "커스터마이징" 참고).

## 이름·링크·날짜는 한 곳에서만 정한다

값이 여러 파일에 흩어지면 하나만 고쳤을 때 조용히 어긋나기 때문에, 출처를 나눠두었습니다.

| 무엇 | 어디 |
| --- | --- |
| 마스코트 이름 · 동아리 이름 · 링크 | [shared/brand.js](shared/brand.js) 의 `NAME` · `ORG` · `SITE_URL` · `GRASS_URL` — 말풍선, 트레이, 학기·사용 안내가 모두 여기서 읽는다 |
| 종강 날짜 | [shared/conference.js](shared/conference.js) 의 `startDate`·`endDate`(같은 날짜) — D-day 팝업, 학기 안내, 세션 알림 시각이 모두 여기서 나온다 |
| 세션 시각 | 같은 파일의 `sessions` 에 시:분만 적으면 종강일 날짜를 쓴다. 학기 안내의 세션 목록은 종강일에만 보인다 |
| 기다리는 시간 | [shared/time.js](shared/time.js) — 잠들기, 말풍선 유지, 딴짓 간격, 프레임 상한, Web Vitals 억제 간격 등 |

**다음 학기 유지보수는 `shared/conference.js` 의 종강 날짜 갱신이 전부입니다.** 저장하면 앱이 다시 읽어 바로 반영합니다 (재시작 불필요).

`shared/time.js`·`shared/brand.js` 는 `require` 와 `<script>` 양쪽으로 읽히도록 만들어져 있어서, main 프로세스와 렌더러가 같은 값을 봅니다. 렌더러에서는 전역 `TIME`·`BRAND` 로 쓰세요.

```js
setTimeout(hideBubble, TIME.BUBBLE_MS); // 6.5초
```

날짜 비교는 `TIME.startOfDay` · `TIME.daysUntil` 을 쓰면 시:분 때문에 D-day 가 하루 틀어지는 일이 없습니다.

## 웹훅 API 스펙 (`http://127.0.0.1:7842`)

| 메서드/경로 | 바디 | 동작 |
| --- | --- | --- |
| `POST /notify` | `{title, message, level, reaction}` | 말풍선 + OS 알림 + 캐릭터 반응. level: `info`·`success`·`warn`·`urgent`(흔들림+오래 표시). `reaction`으로 반응 상태 직접 지정 (`love`·`curious` 등 `ANIM` 에 있는 이름) |
| `POST /activity` | `{state, ttl}` | 사용자 활동 신호 → 반대 모서리로 걸어가 집중, `ttl`(기본 6초) 동안 신호가 없으면 복귀 |
| `POST /state` | `{state, ttl}` | 임의 상태 강제 (ttl ms 후 복귀) — **`ANIM`에 등록한 커스텀 상태도 이걸로 트리거**. `surprise` 는 `notify` 로 취급 |
| `POST /vitals` | `{url, metrics:{LCP, INP, CLS, FCP, TTFB}}` | Core Web Vitals 판정 → 기준 이내면 사랑, 넘기면 갸웃. 임계값은 [lib/vitals.js](lib/vitals.js) |
| `GET /vitals-client.js` | – | 브라우저 측정 스크립트 |
| `GET /health` | – | 상태 확인 (`{ok, dnd, version}`) |

`config.json`에 `token`을 넣으면 `x-token` 헤더(또는 `?token=`)가 필요합니다. 방해 금지 중에는 `/notify` 가 `suppressed: "dnd"` 로 무시됩니다. 새 엔드포인트는 [lib/webhook-server.js](lib/webhook-server.js) 라우팅에 추가하면 됩니다.

## 캐릭터: 스티커 + 코드 모션

캐릭터는 상태마다 **스티커 PNG 한 장(또는 몇 장)** 을 고르고, 움직임은 전부 **코드 모션**(늘이기·회전·이동)으로 줍니다.
모든 설정은 [renderer/mascot.js](renderer/mascot.js) 상단의 `ANIM` 레지스트리 한 곳에 있습니다.

```js
const ANIM = {
  idle: { frames: ['gdg-04'], fps: 0, loop: true, motion: 'breathe' },
  wake: { frames: ['gdg-06', 'gdg-04'], fps: 2.5, loop: false, motion: 'stretch', ms: 900 },
  // …
};
```

| 키 | 뜻 |
| --- | --- |
| `frames` | `character/<이름>.png` 목록 (확장자 생략) |
| `fps` | `frames` 가 2장 이상일 때 넘기는 속도. 1장이면 `0` |
| `loop` | `true` 면 프레임을 계속 돌리는 지속 상태, `false` 면 마지막 장에서 멈추는 1회성 상태 |
| `motion` | 코드 모션 이름 (아래 표) |
| `fx` | 이펙트 — `bang`(!) · `question`(?) · `zzz` · `hearts` |
| `ms` | 1회성 상태가 머무는 시간 = 모션 한 번 길이 |

현재 매핑:

| 상태 | frames | motion | fx | loop | ms | 트리거 |
| --- | --- | --- | --- | --- | --- | --- |
| `idle` | gdg-04 | breathe | – | ✅ | – | 평상시 |
| `sleeping` | gdg-06 | sleep | zzz | ✅ | – | 유휴 5분 (트레이에서 조절) |
| `walking` | gdg-04 | walk | – | ✅ | – | `/activity` 이동 · 가끔 산책 |
| `working` | gdg-02 | typing | – | ✅ | – | 빌드/테스트 진행 중 |
| `happy` | gdg-05 | hop | – | ✅ | – | 성공·정보 알림 |
| `notify` | gdg-03 | startle | bang | ✅ | – | 알림 수신 · 실패·경고 |
| `greet` | gdg-07 | wave | – | 1회 | 1200 | 클릭 · 첫 등장 |
| `love` | gdg-01 | pulse | hearts | 1회 | 1600 | Web Vitals 양호 · 웹훅 |
| `curious` | gdg-04 | tilt | question | 1회 | 1400 | idle 중 랜덤 · Web Vitals 기준 초과 |
| `peek` | gdg-07 | peek | – | 1회 | 1500 | idle 중 랜덤 |
| `wake` | gdg-06 → gdg-04 | stretch | – | 1회 | 900 | 잠 → 깨어남 (0.4초에 눈을 뜬다) |

`happy`·`notify` 처럼 `loop: true` 인 상태를 `ttl` 없이 `/state` 로 띄우면 `TIME.TEMP_LOOP_MS`(3초) 뒤 원래 상태로 돌아갑니다.

### 스티커 교체·추가

1. PNG를 [character/](character/)에 넣습니다. 이름은 **`gdg-` 로 시작**하게 하세요 — `package.json` 의 `files` 가 `character/gdg-*.png` 만 담습니다.
2. `ANIM` 의 `frames` 배열에 파일명(확장자 없이)을 넣습니다. 같은 이름으로 파일만 덮어쓰면 코드는 그대로입니다.
3. 프레임 애니메이션이 필요하면 `frames` 에 여러 장을 넣고 `fps` 를 0보다 크게 줍니다. 코드 모션은 프레임과 상관없이 함께 돕니다.
4. 앱을 다시 시작합니다 (스티커는 시작할 때 읽습니다).

스티커 규격과 배치 규칙:

- **높이 240px, 투명 배경.** 화면에서는 키 `CHAR_H`(96px)로 줄여 그립니다(`K = CHAR_H / 240`). 높이가 다르면 그만큼 크기가 달라 보입니다.
- 모든 스티커는 **발(그림 바닥 중앙)을 같은 점에 맞춰** 그려서, 상태가 바뀌어도 발이 튀지 않습니다. 몸통이 그림 중앙에서 벗어난 스티커는 `CENTER_SHIFT` 에 원본 px 로 보정값을 줍니다 — 지금은 노트북이 오른쪽으로 삐져나온 `gdg-02` 만 `16`.
- **좌우 반전은 하지 않습니다** (배의 GDG 로고가 뒤집힌다). 걷는 방향은 몸 기울기로만 보여줍니다.
- 상태가 바뀔 때 `FADE_MS`(150ms) 동안 크로스페이드합니다. 읽기 전이거나 실패한 스티커는 오류 없이 건너뜁니다.
- 캐릭터 크기(`CHAR_H`)를 바꾸면 말풍선 꼬리 위치 [renderer/style.css](renderer/style.css) 의 `--bubble-bottom` 도 함께 맞추세요.

### 모션 종류와 조정

모션은 `pose(a, t, d)` 의 `case` 하나씩입니다. 상태가 시작되고 `t` ms 뒤의 몸 변형을 돌려줍니다 — 발을 축으로 `x`·`y` 이동(px, 위가 −), `sx`·`sy` 늘이기, `r` 회전(rad, + 는 시계 방향).

| motion | 움직임 | 조정할 값 |
| --- | --- | --- |
| `breathe` | 세로로 1.5% 늘었다 줄었다 | 진폭 `0.015`, 주기 `3200`ms |
| `sleep` | 깊고 느린 숨 — 배가 옆으로도 부푼다 | 진폭 `0.03`/`0.012`, 주기 `4500`ms |
| `typing` | 자판 두드리는 잔떨림 + 노트북 쪽으로 숙이기 | 떨림 `1.5`px·`360`ms, 기울기 `0.035` |
| `hop` | 땅에서 납작해졌다 펴며 통통 점프 | 주기 `720`ms, 높이 `-56 * v * (1 - v)`(꼭대기 14px) |
| `startle` | 깜짝 튀어올랐다 좌우로 부들부들 | 튀는 높이 `12`px·`360`ms, 떨림 폭·감쇠 |
| `wave` | 좌우로 흔들며 인사 | 각도 `0.1`rad, 주기 `400`ms |
| `pulse` | 두근두근 — 0.8초에 두 번 | 크기 `0.06`, 주기 `800`ms |
| `tilt` | 갸웃했다가 끝날 때 돌아온다 | 각도 `-0.14`rad, 키프레임 시각 |
| `peek` | 바닥 아래로 숨었다가 눈만 빼꼼, 그리고 쑥 | 키프레임 `[ms, 높이]` 목록 |
| `stretch` | 기지개 — 쭉 늘었다가 살짝 눌리며 안착 | 키프레임 `[ms, sy]` 목록 |
| `walk` | 한 발씩 통통, 좌우로 기울며 가는 쪽으로 숙이기 | 높이 `3`px, 주기 `600`ms, 숙임 `0.05` |

- 키프레임 모션은 `kf(t, [[ms, 값], …])` 로 씁니다. 사이는 부드럽게(smoothstep) 이어집니다.
- **새 모션**: `pose` 에 `case '이름':` 을 추가하고 `ANIM` 에서 `motion: '이름'` 으로 씁니다. 1회성 상태라면 `ms` 를 모션 길이에 맞추세요.
- **이펙트**는 `drawFx` 에 있습니다. 말풍선이 머리 오른쪽 위를 덮으므로 머리 왼쪽 위(`FX_X`·`FX_Y`)에 띄웁니다. 색은 브랜드 팔레트(`!` 빨강 · `?` 파랑 · 하트 빨강 · Z 잉크)입니다.
- 그리기 빈도: 모션 중 최대 `TIME.DRAW_FPS_CAP`(30fps), 숨쉬기·잠은 `TIME.DRAW_FPS_MIN`(12fps). 결과가 기기 픽셀 단위로 같으면 다시 그리지 않고, 창이 숨겨져 있으면 그리지 않습니다.
- 시스템 "동작 줄이기"(`prefers-reduced-motion`)가 켜져 있으면 모션은 끄고 스티커·이펙트만 바꿉니다.

## 말풍선

`BUBBLE_STYLES`(renderer/mascot.js)에 등록된 스타일 중 `bubbleStyle` 하나를 씁니다. 기본은 `gdg` — D-day 팝업과 같은 진한 초록 박스입니다. 바꾸려면 `let bubbleStyle = 'gdg';` 를 고치세요.

| 스타일 | 방식 | 그리드 | baseW | cellCss | insL / insR | padL / padR |
| --- | --- | --- | --- | --- | --- | --- |
| `gdg` (기본) | CSS 박스, 텍스트만큼 저절로 늘어남 | – | – | – | – | – |
| `banner` | CSS 박스 (흰 배경 + 초록 테두리) | – | – | – | – | – |
| `classic` | SVG 생각풍선 (고정 크기) | – | – | – | – | – |
| `comic` | bubble-comic | 30×12 | 208 | 6.05 | 6 / 20 | 32 / 24 |
| `purple` | bubble-purple | 24×7 | 196 | 7.38 | 6 / 16 | 26 / 18 |
| `cozy` | bubble-cozy | 32×12 | 212 | 5.83 | 9 / 24 | 28 / 18 |

CSS 말풍선 색은 [renderer/style.css](renderer/style.css) 의 `#bubble.style-gdg` · `#bubble.style-banner` 블록에서 바꿉니다.

픽셀 말풍선은 JSON **1페이지(정적)** 입니다. 텍스트가 길어지면 이미지를 늘리는 게 아니라, **지정한 중앙 컬럼을 그리드 규칙대로 복제**해서 픽셀이 깨지지 않게 넓힙니다 (최대 `BUBBLE_MAX_W` = 245px).

- `baseW`: 스트레치 0일 때 표시 폭(px) · `cellCss`: 셀 1칸의 CSS px
- `insL`/`insR`: 복제 삽입 지점 컬럼 인덱스 — **꼬리 양옆의 "세로로 균일한" 컬럼**을 골라야 늘려도 티가 안 납니다
- `padL`/`padR`: 텍스트 여백(px) — 모서리·꼬리 캡 폭에 맞춤

**새 픽셀 말풍선 추가하기**: ① 말풍선 JSON을 그려서 `character/bubble-<이름>.json` 으로 넣고 ② `BUBBLE_STYLES`에 한 줄 추가 ③ 텍스트 색이 필요하면 [renderer/style.css](renderer/style.css)에 `#bubble.style-<이름>` 블록 추가 (기존 3종 참고). 레벨별 연출(`urgent` 흔들림 등)은 스타일과 무관하게 공통 적용됩니다.

### 픽셀 말풍선 JSON 포맷 (마름모 아트보드)

```jsonc
{
  "version": 1,
  "active": 0,            // 에디터용 — 앱은 무시
  "pages": [              // 말풍선은 1페이지만 쓴다
    {
      "name": "만화 말풍선",
      "cfg": {
        "cols": 30,       // 그리드 가로 칸 수
        "rows": 12,       // 그리드 세로 칸 수
        "cell": 36,       // 원본 셀 크기(px) — radius/overlap의 기준 단위
        "angleDeg": -20,  // 스큐 각도. 위로 갈수록 오른쪽으로 기움
        "line": 0,        // (미사용)
        "merge": true,    // 같은 색 연속 칸 캡슐 병합
        "radius": 20,     // 블록 모서리 라운드 (cell 기준 px)
        "overlap": 2      // 블록끼리 살짝 겹치는 양 — 이음새 제거용
      },
      "grid": [           // rows × cols 2차원 배열
        [null, null, "#141018", ...]   // hex 색상 = 픽셀, null = 빈 칸
      ]
    }
  ]
}
```

렌더링 규칙 (renderer/mascot.js `buildFrame`):

1. **셀 1칸 = 기울어진(-20°) 둥근 마름모 블록.** 위로 갈수록 오른쪽으로 밀리는 스큐가 걸립니다.
2. **가로로 같은 색이 이어지면 캡슐 하나로 병합**해서 그립니다. 외따로 있는 1칸짜리는 세로 방향으로 다시 병합을 시도합니다.
3. 앱은 시작할 때 `character/bubble-*.json` 만 읽습니다 ([lib/anims.js](lib/anims.js)). 파일명 오타는 그 스타일만 조용히 미표시됩니다.

## 검증 절차

1. `npm start`로 실행
2. 트레이에서 **사용 안내** / **학기 안내**로 UI 확인, 캐릭터를 두 번 클릭해 D-day 팝업 확인
3. 상태·모션·말풍선은 웹훅으로 확인 (상태 이름은 위 `ANIM` 표):

```bash
node scripts/send.js notify "제목" "메시지가 길면 말풍선이 옆으로 늘어나요" success
node scripts/send.js state happy
node scripts/send.js state love
node scripts/send.js activity working
```

4. 스티커 PNG·말풍선 JSON을 바꿨으면 앱 재시작. `shared/conference.js` 는 저장만 하면 반영됩니다.

## 커스터마이징 예시

아트만 교체하거나, 앱 동작을 확장할 수 있습니다.

**아트**

- **스티커 교체** — 같은 파일명으로 덮어쓰거나, 새 PNG를 넣고 `ANIM` 의 `frames` 만 바꾸기
- **프레임 애니메이션** — `frames` 에 여러 장 + `fps`
- **모션 조절** — `pose` 의 진폭·주기 숫자, 새 모션은 `case` 하나
- **말풍선 스타일 추가** — JSON 1개 + `BUBBLE_STYLES` 1줄

**앱**

- **이름·링크 변경** — [shared/brand.js](shared/brand.js)
- **새 상태/행동 추가** — `ANIM`에 상태 등록 후 `POST /state {"state":"내상태"}`로 트리거, main.js 상태 머신에 규칙 추가
- **새 연동** — [integrations/mascot-client.js](integrations/mascot-client.js)를 재사용해 webpack / git hook / CI / Slack 등과 웹훅으로 연결
- **새 웹훅 엔드포인트** — [lib/webhook-server.js](lib/webhook-server.js) 라우팅에 추가
- **학기 안내 UI** — guide.\* 파일을 수정하거나 교체
- **창 동작** — main.js에서 위치·다중 인스턴스·모니터 이동 등 확장
