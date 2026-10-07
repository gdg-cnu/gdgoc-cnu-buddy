# GDGoC CNU 마스코트

빌드와 테스트 상태를 화면 구석에서 실시간으로 알려주는 Electron 데스크톱 캐릭터입니다.  
모습은 초록 TV 머리 로봇이고, 이름은 [shared/brand.js](shared/brand.js) 의 `NAME` 에서 정합니다.

## 기본 제공 구성

- **캐릭터 스티커 7장** — `character/gdg-01.png` ~ `gdg-07.png` (투명 PNG, 높이 240px)
- **코드 모션 11종** — 숨쉬기·타이핑·점프·깜짝·인사·두근·갸웃·빼꼼·기지개·걷기·잠
  움직임은 그림이 아니라 코드(늘이기·회전·이동)라서 스티커 한 장으로도 살아 움직입니다
- **이펙트** — `!` · `?` · Z · 하트를 캔버스에 직접 그립니다
- **말풍선** — 진한 초록 알림(기본) · 흰 배너 · 픽셀 말풍선 3종(comic · purple · cozy)
- **픽셀 폰트** — MonaS12

## 감정 상태

| 상태 | 스티커 | 모션 | 트리거 |
| --- | --- | --- | --- |
| `idle` | 04 차분히 웃음 | breathe — 세로로 살짝 숨쉬기 | 평상시 |
| `working` | 02 노트북 벼락치기 | typing — 잔떨림 + 노트북 쪽으로 숙이기 | 빌드/테스트 진행 중 · `/activity` 로 걸어가 도착한 뒤 |
| `happy` | 05 양손 브이 | hop — 통통 점프 | 성공·정보 알림 |
| `notify` | 03 넋 나감 + `!` | startle — 깜짝 튀었다 부들부들 | 알림 수신 직후 · 실패·경고 알림 |
| `walking` | 04 차분히 웃음 | walk — 통통 걸으며 가는 쪽으로 기울기 | `/activity` 이동 · 쉬는 중 가끔 산책 |
| `sleeping` | 06 노트북 덮어쓰고 지침 + Z | sleep — 깊고 느린 숨 | 유휴 5분 (트레이에서 조절) |
| `greet` | 07 수줍은 브이 | wave — 좌우로 흔들기 | 클릭 · 첫 등장 · `⌘⇧H` |
| `love` | 01 하트 안기 + 하트 | pulse — 두근두근 | Web Vitals 기준 이내 · 웹훅 |
| `curious` | 04 차분히 웃음 + `?` | tilt — 갸웃 | idle 중 랜덤 · Web Vitals 기준 초과 |
| `peek` | 07 수줍은 브이 | peek — 바닥 아래 숨었다 빼꼼 | idle 중 랜덤 |
| `wake` | 06 → 04 | stretch — 기지개 | 잠에서 깰 때 |

상태별 스티커·모션은 [`renderer/mascot.js`](renderer/mascot.js) 상단의 `ANIM` 한 곳에서 정합니다.
시스템에서 "동작 줄이기"를 켜면 움직임은 멈추고 표정·이펙트만 바뀝니다.

## 학기 D-day

기준은 **종강일**이고, [`shared/conference.js`](shared/conference.js) 의 `startDate`·`endDate` 에서만 정합니다.

- 두 번 클릭 팝업 — "종강까지 D-75" / "종강 D-DAY" / "종강 D+3"
- 트레이 → 학기 안내 — 학기 중 / 종강일 / 방학 세 화면이 날짜로 자동 전환

다음 학기에는 이 날짜만 고치면 됩니다. 저장하면 앱이 바로 다시 읽습니다.

## 확장 가능한 픽셀 말풍선

픽셀 말풍선은 색상 그리드 JSON(`character/bubble-*.json`)입니다.

텍스트 길이에 따라 중앙 컬럼을 반복 복제하는 방식으로 크기가 늘어나기 때문에, 말풍선을 확장해도 픽셀 그래픽이 깨지지 않습니다.

## 외부 도구 연동

`localhost:7842` 웹훅을 통해 어떤 도구와도 연결할 수 있습니다.

- `/notify` — 알림
- `/state` — 상태 전환
- `/activity` — 코딩 활동
- `/vitals` — Core Web Vitals 실측값 전달 (기준 이내면 love, 넘기면 curious)

## 메인 프로세스 구조

진입점은 [`main.js`](main.js) 이고, 설정·애셋 로드·vitals·웹훅은 [`lib/`](lib/) 로 나뉩니다.

자세한 제작 규칙과 스펙은 [CUSTOMIZING.md](CUSTOMIZING.md)를 참고하세요.
