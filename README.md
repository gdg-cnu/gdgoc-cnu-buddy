# gdgoc-buddy

화면 구석에 상주하는 GDGoC CNU 마스코트 **지디**입니다.
**빌드·테스트·타입체크·dev 서버** 상태를 표정과 말풍선으로 알려 주고 종강 D-day와 동아리 링크도 챙겨 주는 Electron 데스크톱 앱입니다.

> 이름 '지디'는 임시입니다. [shared/brand.js](shared/brand.js) 의 `NAME` 한 줄만 바꾸면 말풍선·트레이·안내창이 모두 따라 바뀝니다.

앱이 꺼져 있으면 CLI·웹훅 연동은 조용히 무시합니다. 빌드나 Claude Code 작업을 막지 않습니다.

커스터마이징·웹훅·애셋 스펙은 [CUSTOMIZING.md](CUSTOMIZING.md)에, 구성 요약은 [OVERVIEW.md](OVERVIEW.md)에 있습니다.

---

## 특징

- 초록 TV 머리 로봇 스티커 7장(`character/gdg-*.png`)과 코드 모션(숨쉬기·점프·흔들기…)
- 빌드/테스트 메이트 — `gdgoc` / `mascot-watch` 로 아무 명령이나 감싸기
- Web Vitals 피드백 — `gdgoc npm run dev` 또는 Vite 플러그인으로 LCP·INP·CLS에 반응
- 투명 · 항상 위 · 드래그 · 트레이 상주 · 빈 영역 클릭 통과
- 클릭하면 인사, 두 번 클릭하면 종강 D-day, 트레이에서 학기 안내·사용 안내·방해 금지·잠드는 시간
- 웹훅 `http://127.0.0.1:7842` — 알림 · 상태 · 활동 · vitals
- 종강 날짜·세션 알림 — [shared/conference.js](shared/conference.js)
- 유휴 시 잠자기 · 전역 단축키 `⌘⇧M` / `⌘⇧H` (Windows·Linux는 `Ctrl+Shift+…`)

---

## 실행

Node.js 18+가 필요합니다. 아직 npm에 배포하지 않았으니 저장소를 클론해서 씁니다. `npm install` 때 Electron을 받느라 1~2분 걸릴 수 있습니다.

```bash
git clone https://github.com/gdg-cnu/gdgoc-cnu-buddy.git
cd gdgoc-cnu-buddy
npm install
npm start
```

---

## 프로젝트에 연결 (빌드 · 성능)

마스코트를 켠 뒤, **내 프로젝트 폴더**에서 클론한 저장소의 CLI를 경로로 부릅니다:

```bash
node <클론 경로>/integrations/gdgoc.js npm run build   # 빌드/테스트 → 시작·성공·실패 반응
node <클론 경로>/integrations/gdgoc.js npm run dev     # dev 서버 → Web Vitals 피드백
```

줄여 쓰려면 프로젝트에서 `npm i -D <클론 경로>` 를 한 번 해 두세요. 그 뒤로는 그 폴더에서 `npx gdgoc …`, `npx mascot-watch …`, `npx mascot-dev …` 가 됩니다 (package.json 에 `file:` 경로가 기록됩니다). 아래 예시는 이렇게 연결했다고 보고 `npx` 로 적었습니다.

| 하고 싶은 일 | 명령 |
| --- | --- |
| 앱 실행 | 클론한 폴더에서 `npm start` |
| 빌드·테스트 반응 | 내 프로젝트에서 `npx gdgoc npm run build` |
| 성능 피드백 | 내 프로젝트에서 `npx gdgoc npm run dev` |
| 연결 없이 | `node <클론 경로>/integrations/gdgoc.js npm run build` |

동작 규칙:

- 스크립트 이름이 `dev` / `start` / `serve` / `preview`(또는 `start:dev`)이면 **성능 측정**
- `start:prod` 처럼 프로덕션 계열은 **빌드 감시**
- 그 외(`build`, `test`, `lint` …)는 **빌드 감시**
- 강제: `npx gdgoc --watch <명령>` · `npx gdgoc --dev <명령>`

하위 CLI: `mascot-watch` · `mascot-dev` (연결 없이 쓰려면 `node <클론 경로>/integrations/mascot-watch.js …`)

### `mascot-watch` — 아무 명령이나 감싸기

```bash
npx mascot-watch npm run build
npx mascot-watch -- vitest run
npx mascot-watch --label "타입체크" tsc --noEmit
```

출력·종료 코드는 그대로 통과합니다.

### `mascot-dev` — dev 서버 + Web Vitals

프로젝트 파일을 건드리지 않고 HTML에만 측정 스크립트를 끼웁니다.

```bash
npx gdgoc npm run dev
# 또는
npx mascot-dev npm run dev
npx mascot-dev --port 5173 -- npm run dev   # 포트 직접 지정
npx mascot-dev --sidecar -- npm run dev     # 옆 포트(7843)에 프록시
```

기준은 [web.dev Core Web Vitals](https://web.dev/articles/vitals)를 따릅니다. 전부 기준 이내면 사랑(`love`), 넘기면 갸웃(`curious`)으로 반응합니다.

### Vite 플러그인

```js
// vite.config.js — 클론한 폴더까지의 경로로 불러온다
import mascot from '<클론 경로>/integrations/vite-plugin-mascot.js';

export default {
  plugins: [mascot()], // { hmr: false } · { vitals: false } 가능
};
```

- dev 준비됨 / HMR 저장 / `vite build` 성공·실패에 반응
- Web Vitals 실측 (끄려면 `vitals: false`)

### 환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `MASCOT_PORT` | `7842` | 앱 웹훅 포트 (Electron도 이 값을 본다) |
| `MASCOT_HOST` | `127.0.0.1` | 앱 호스트 |
| `MASCOT_TOKEN` | (없음) | 앱에 `token` 설정 시 함께 지정 (`?token=` / `x-token`) |
| `MASCOT_DISABLE` | (없음) | `1`이면 전송 끔 (CI 등) |

---

## 웹훅

앱은 `http://127.0.0.1:7842`에서 대기합니다.

```bash
curl -X POST localhost:7842/notify \
  -H 'Content-Type: application/json' \
  -d '{"title":"정기 세션","message":"곧 시작해요","level":"success"}'

curl -X POST localhost:7842/activity -d '{"state":"working"}'
curl -X POST localhost:7842/state -d '{"state":"happy","ttl":3000}'
curl localhost:7842/health
```

| 경로 | 용도 |
| --- | --- |
| `POST /notify` | 말풍선 + OS 알림 + 표정 (`level`: `info`·`success`·`warn`·`urgent`) |
| `POST /activity` | 코딩 활동 → 걷기/집중 |
| `POST /state` | 임의 상태 (`greet`·`happy`·`notify`·`love` …) |
| `POST /vitals` | Core Web Vitals 판정 |
| `GET /vitals-client.js` | 브라우저 측정 스크립트 |
| `GET /health` | 상태 확인 |

편의 스크립트 (클론한 폴더에서):

```bash
node scripts/send.js notify "제목" "메시지" success
node scripts/send.js activity working
node scripts/send.js state sleeping
```

---

## Claude Code 연동

[Claude Code](https://claude.com/claude-code) 훅에 연결하면 작업 완료·입력 대기 때 마스코트가 알려 줍니다.

`~/.claude/settings.json`(전역) 또는 프로젝트 `.claude/settings.json`에 `hooks`만 병합하세요.

```jsonc
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST localhost:7842/notify -H 'Content-Type: application/json' -d '{\"title\":\"⭐️ 야호~작업 완료~🎵⭐️\",\"message\":\"Claude Code가 작업을 마쳤어요\",\"level\":\"success\"}' >/dev/null 2>&1 || true"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST localhost:7842/notify -H 'Content-Type: application/json' -d '{\"title\":\"확인이 필요해요\",\"message\":\"Claude Code가 입력을 기다리고 있어요\",\"level\":\"warn\"}' >/dev/null 2>&1 || true"
          }
        ]
      }
    ]
  }
}
```

- 앱이 꺼져 있으면 `|| true`로 무시하므로 Claude Code를 막지 않습니다
- 포트·토큰을 바꿨으면 URL/`x-token`을 맞추세요
- 적용이 안 되면 Claude Code에서 `/hooks`를 열거나 재시작하세요

다른 CLI·CI·git hook도 똑같이 `POST /notify` 한 줄이면 됩니다.

---

## 앱 UI · 단축키

| 조작 | 동작 |
| --- | --- |
| 클릭 | 인사 + 한마디 |
| 두 번 클릭 | 종강 D-day 팝업 |
| 드래그 | 위치 이동 |
| 트레이 | 학기 안내 · 방해 금지 · 잠드는 시간 · 사용 안내 · 종료 |
| `⌘⇧M` / `Ctrl+Shift+M` | 숨김 / 표시 |
| `⌘⇧H` / `Ctrl+Shift+H` | 인사 |

### 학기 안내

트레이에서 **학기 안내**를 엽니다. 날짜에 따라 자동 전환되고 세 화면 모두 아래에 팀 모집 사이트·잔디 심기 챌린지 링크가 붙습니다.

| 상태 | 시점 | 내용 |
| --- | --- | --- |
| before | 종강 전 | 종강까지 D-day · 날짜 |
| dayof | 종강일 | 종강 인사 (+ 세션이 있으면 다음 세션 카운트다운·타임라인) |
| after | 종강 후 | 방학 D+n |

종강 날짜·세션은 [shared/conference.js](shared/conference.js) 한곳에서 수정합니다. 저장하면 앱이 다시 읽어 바로 반영합니다.

### 상태(표정·모션)

상태마다 스티커 한 장과 코드 모션이 붙습니다. 상태별 스티커·모션·트리거 표는 [OVERVIEW.md](OVERVIEW.md)에 있습니다.

---

## 커스터마이징

- 애셋: `character/` — `gdg-*.png`(캐릭터 스티커), `bubble-*.json`(픽셀 말풍선)
- 상태별 스티커·모션: [renderer/mascot.js](renderer/mascot.js) 의 `ANIM`
- 이름·링크: [shared/brand.js](shared/brand.js) · 종강 날짜: [shared/conference.js](shared/conference.js)
- 자세한 방법·웹훅·구조: [CUSTOMIZING.md](CUSTOMIZING.md)

원하면 **실행 cwd** 또는 저장소 폴더에 `config.json`을 두어 기본값을 덮어쓸 수 있습니다
(`MASCOT_PORT` / `MASCOT_TOKEN` 환경변수가 더 우선합니다).

```json
{
  "port": 7842,
  "token": "",
  "corner": "bottom-right",
  "idleSleepMs": 300000,
  "guideTitle": "학기 안내",
  "guideSubtitle": ""
}
```

`token`을 켜면 웹훅·vitals에 `x-token` 또는 `?token=`이 필요합니다.
`mascot-dev`는 `MASCOT_TOKEN`을 측정 스크립트 URL에 붙여 주므로, 커스텀 헤더를 못 넣는 브라우저 `sendBeacon` 요청도 토큰 검사를 통과합니다.

---

## 요구 사항 · 참고

- Node.js **≥ 18** · Electron 33
- 웹훅 기본 포트 **7842** (`MASCOT_PORT` / `config.json`으로 변경 가능)
- `npm install` 시 Electron 런타임을 함께 받습니다 (용량·CI 주의)
- CI에서는 `MASCOT_DISABLE=1` 권장

---

## 출처 · 라이선스

- 코드: MIT — [LICENSE](LICENSE)
- 캐릭터 스티커 `character/gdg-*.png` 는 GDGoC CNU 디자인 애셋입니다. 외부에서 다시 쓰려면 운영진에 문의해 주세요.
- 말풍선 픽셀 폰트: **Mona (MonaS12)** by [Monad ABXY](https://github.com/MonadABXY/mona-font) — SIL OFL 1.1
