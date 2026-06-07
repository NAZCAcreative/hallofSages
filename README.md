# 🏛️ Hall of Sages — 현자들의 전당

세 현자(**예수님 · 부처님 · 공자님**)가 사는 작은 세계를 돌아다니며,
가까이 다가가 **AI와 대화**하는 2D 대화형 RPG (MVP).

Next.js 15 (App Router) · TypeScript · Phaser.js · OpenAI 로 구현했습니다.

## 플레이 방법

1. **방향키(↑↓←→)** 로 방문자 캐릭터를 움직입니다.
2. 현자(예수님/부처님/공자님)에게 다가가면 상단에
   **"〇〇님께 E 키로 질문하기"** 안내가 뜹니다.
3. **E 키**를 누르면 질문 입력창이 열립니다.
4. 질문을 적고 **질문하기**(또는 ⌘/Ctrl+Enter)를 누르면
   `/api/chat` 으로 전송됩니다.
5. 각 현자는 **고유한 성격(시스템 프롬프트)** 으로 답하며,
   답변은 화면 **하단 대화창**에 표시됩니다.

> 전투 · 저장 · 로그인은 의도적으로 제외한 MVP입니다.
> 캐릭터 이동과 AI 대화에 집중되어 있습니다.

## 실행하기

```bash
npm install
npm run dev      # http://localhost:3000
```

빌드/프로덕션:

```bash
npm run build && npm start
```

## 환경 변수 (`.env.local`)

```bash
OPENAI_API_KEY="sk-..."     # OpenAI 키 (필수가 아니어도 동작 — 아래 참고)
# OPENAI_MODEL="gpt-4o-mini" # 선택, 기본값 gpt-4o-mini
```

- **키가 있으면**: 실제 OpenAI 호출로 답변합니다 (`source: "openai"`).
- **키가 없거나 호출 실패 시**: 각 현자 성격에 맞는 **모의 답변**으로
  자동 대체되어, 키 없이도 게임이 끊기지 않습니다 (`source: "fallback"`).

## 에셋 (요구사항 9)

`public/assets/` 에 PNG를 넣으면 캐릭터 스프라이트로 사용됩니다:

| 파일 | 대상 |
|------|------|
| `player.png` | 방문자 |
| `jesus.png` | 예수님 |
| `buddha.png` | 부처님 |
| `confucius.png` | 공자님 |

파일이 **없으면 자동으로 색상 사각형**으로 대체되어 그대로 플레이할 수 있습니다.
(예수=금색, 부처=호박색, 공자=파란색)

## 프로젝트 구조

```
src/
  app/
    page.tsx              # 게임 화면 (GameShell 마운트)
    layout.tsx, globals.css
    api/chat/route.ts     # POST {npc, message} → OpenAI → {reply}  (요구사항 6,7)
  game/
    GameShell.tsx         # React 오버레이: 근접 안내 / 질문 모달 / 하단 대화창
    PhaserGame.tsx        # Phaser 게임 동적 마운트 (SSR 비활성)
    MainScene.ts          # 월드·플레이어 이동·NPC·근접 감지·E키·에셋 폴백
    bus.ts                # Phaser ↔ React 이벤트 브리지
    npcs.ts               # NPC 3인 배치/색상/위치
  lib/
    npcPrompts.ts         # NPC별 시스템 프롬프트 + 오프라인 폴백 답변
```

## 동작 검증 (스모크 테스트 결과)

- `npm run build` ✅ 통과 (5 routes)
- `GET /` ✅ 200, 게임 화면 렌더
- `POST /api/chat` ✅ 세 NPC 모두 고유 성격으로 응답 (`source: "openai"`)
- 잘못된 npc / 빈 메시지 → ✅ 400 검증
- 키 미설정/오류 시 → ✅ 폴백 답변으로 자동 대체

## 다음에 더 해볼 것

캐릭터 PNG 아트, 대화 히스토리, 답변 스트리밍, 사운드, 모바일 터치 컨트롤 등.
