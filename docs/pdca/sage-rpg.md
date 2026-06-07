# PDCA — Sage RPG (Hall of Sages MVP)

> Condensed PDCA record (yolo mode: single doc instead of the full multi-phase
> document set, since requirements were fully specified up front).

## Executive Summary

| 관점 | 내용 |
|------|------|
| Problem | 현자(예수/부처/공자)에게 자유롭게 묻고 싶지만 정적인 텍스트 챗은 몰입감이 없다. |
| Solution | 2D RPG로 돌아다니며 NPC에 다가가 AI 대화하는 경험. |
| Function/UX | 방향키 이동 → 근접 안내 → E키 질문 모달 → 하단 대화창 답변. |
| Core Value | "걸어가서 만나 묻는" 체화된 인터랙션 + NPC별 인격. |

## Plan — 요구사항 (10) → 충족

| # | 요구사항 | 상태 | 근거 |
|---|----------|:---:|------|
| 1 | Phaser 캔버스 표시 | ✅ | `MainScene.ts` / `PhaserGame.tsx`, `/` 200 |
| 2 | 방향키 이동 | ✅ | `update()` cursor keys + clamp |
| 3 | NPC 3인 배치 | ✅ | `npcs.ts` (jesus/buddha/confucius) |
| 4 | 근접 시 "E 키로 질문하기" | ✅ | proximity 이벤트 → 상단 안내 |
| 5 | E키 → 질문 모달 | ✅ | `ask` 이벤트 → `GameShell` 모달 |
| 6 | /api/chat 전송 | ✅ | `GameShell.submit()` POST |
| 7 | NPC별 시스템 프롬프트 | ✅ | `npcPrompts.ts` 3 personas, 실측 응답 상이 |
| 8 | 하단 대화창 표시 | ✅ | `GameShell` dialogue box |
| 9 | PNG 에셋 + 사각형 폴백 | ✅ | `makeActor()` textures.exists 분기 |
| 10 | 실행 가능 MVP + README | ✅ | build 통과, README 작성 |

스코프 제외(의도적): 전투 · 저장 · 로그인.

### Plan 확장 — 초기 MVP 이후 추가 출하분 (post-doc 커밋 반영)

| # | 추가 요구사항 | 상태 | 근거 |
|---|----------------|:---:|------|
| 11 | RAG 근거 검색 + 출처 표기 | ✅ | `lib/rag.ts` BM25 over `data/rag/documents/all_units.json` (5.4MB 번들), `/api/chat` `sources` 반환 |
| 12 | 동시 질문 (Enter → 세 현자에게 한 번에) | ✅ | `bus.askAll` / `reqAskAll`, `GameShell` ask-all 흐름 |
| 13 | 모바일/터치 컨트롤 | ✅ | `bus.touchMove`/`reqInteract`/`reqAskAll`, 포트레이트 레이아웃 `npcs.ts` `WORLD_PORTRAIT`/`PORTRAIT_POS` |
| 14 | 답변 직후 "!" 이모트 + 파티클 | ✅ | `bus.sageAnswered` → MainScene emote burst |
| 15 | 배경음악 플레이어 (모바일 자동재생) | ✅ | `MusicPlayer.tsx` muted-autoplay → first-gesture unmute |
| 16 | 신비로운 배경 연출 | ✅ | `MysticBackground.tsx` |

스코프 제외(여전히 의도적): 전투 · 저장 · 로그인.

## Design — 아키텍처 (선택: Pragmatic Balance)

- **Phaser(게임 로직)** 와 **React(UI 오버레이)** 분리.
- 둘 사이는 Phaser-free **이벤트 버스**(`bus.ts`)로 연결 (`proximity`/`ask`/`resume`).
- 게임은 캔버스·이동·근접·E키 감지를 담당, React는 안내·모달·대화창을 담당.
- 키보드 캡처 충돌(텍스트area에 'e' 입력 차단) → 모달 오픈 시 `keyboard.enabled=false`,
  화살표만 capture, E는 uncaptured 로 해결.
- AI: `/api/chat` 에서 OpenAI 호출, 실패/무키 시 persona별 폴백 → 항상 동작.

## Check — 검증 결과 (Match Rate ≈ 100%, 재검증 2026-06-08)

- `npm run build` ✅ Next.js 15.5.19, 5 routes, 26.2s 컴파일 성공 (EXIT 0).
- `GET /` ✅ 정적 prerender (9.15 kB / 112 kB First Load).
- `POST /api/chat` ✅ jesus/buddha/confucius 각각 고유 인격(VOICE) + RAG 근거 주입.
- 입력 검증: 깨진 JSON / 잘못된 npc / 빈 메시지 → 모두 400 (코드 경로 확인).
- 폴백 이중화: 키 없음 → `source:"fallback"`, OpenAI 오류 → catch 후 `source:"fallback"`. RAG는 키 유무와 무관하게 동작.
- RAG 데이터: `data/rag/documents/all_units.json` (5.4MB) 번들 확인 → 서버리스 배포 가능.
- 16개 요구사항(원본 10 + 추가 6) 전부 코드 근거로 충족 → Match Rate ≈ 100%, gap 0.

런타임 미검증 항목(브라우저 상호작용): 실제 캐릭터 이동·E키·모달·터치 D-pad·
모바일 음악 자동재생 흐름은 정적/유닛이 아닌 수동 플레이 검증 권장 (`npm run dev`).

## Act — 후속 제안

PNG 아트 적용, 답변 스트리밍, 대화 히스토리, 모바일 터치 컨트롤.
