# 🛡️ Aegis v3 — Parallel Development Swarm

**하나의 모델. 여러 개의 방패. 코드 유출 제로.**

> "Under the Aegis — your code never leaves."

---

## 핵심 아이디어

사내 GPU 한 장에서 Qwen3-Coder-Next를 돌리면, 외부 API 없이도 **동시에 10개 이상의 AI 에이전트**를 굴릴 수 있습니다. MoE 모델이라 토큰당 3B만 활성화되기 때문입니다.

이걸 이용해서:

```
"쇼핑몰 만들어줘"
         │
    ┌────▼────────────────────────────────────────────────┐
    │  🛡️ Commander (설계 + 통합)                          │
    │                                                     │
    │  "기능 4개로 나눠서 동시에 만들겠습니다"                 │
    │                                                     │
    │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
    │  │🛡️Worker#1│ │🛡️Worker#2│ │🛡️Worker#3│ │🛡️W#4  │ │
    │  │ 대시보드   │ │ 상품 목록  │ │ 장바구니   │ │ 결제   │ │
    │  │ +Scout   │ │ +Scout   │ │ +Scout   │ │+Scout │ │
    │  │ +Lib     │ │ +Lib     │ │ +Lib     │ │+Lib   │ │
    │  └──────────┘ └──────────┘ └──────────┘ └────────┘ │
    │       ⬇️ 동시 개발 (vLLM concurrent inference)        │
    │                                                     │
    │  Commander: 충돌 확인 → 통합 QA → 커밋                 │
    └─────────────────────────────────────────────────────┘
         │
         ▼ 전부 localhost:8001 (사내 vLLM)
    코드가 외부로 나가지 않음 ✅
```

---

## vs 기존 도구

| | Claude Code Teams | oh-my-opencode | **Aegis v3** |
|---|---|---|---|
| 모델 | Claude (Anthropic 서버) | 5개 외부 API | **사내 vLLM** |
| 병렬 개발 | 사용자별 세션 분리 | 에이전트별 병렬 | **기능별 Worker 병렬** |
| 비용 | API 사용량 비례 | 5개 API 비용 합산 | **GPU 전기세만** |
| 데이터 보안 | 외부 전송 | 5곳 분산 전송 | **완전 격리** |
| 설계 | 없음 (바로 코딩) | 없음 (바로 탐색) | **사용자와 합의** |
| QA | 수동 | 프롬프트 권고 | **훅으로 강제** |
| 충돌 방지 | 없음 | 없음 | **파일 스코프 분리** |

---

## 빠른 시작

```bash
# 1. OpenCode 설치
curl -fsSL https://opencode.ai/install | bash

# 2. oh-my-qwencoder 설치
npm install -g oh-my-qwencoder

# 3. vLLM 서버 (H200)
oh-my-qwencoder start-vllm

# 4. 프로젝트에 설치
cd /your/project
oh-my-qwencoder install

# 5. 건강 체크
oh-my-qwencoder doctor

# 6. 실행
opencode
```


---

## 사용 예시

### 대규모 프로젝트 (Worker 4개 병렬)

```
You: 실시간 채팅이 되는 프로젝트 관리 앱 만들어줘.
     대시보드, 칸반보드, 실시간 채팅, 알림 기능이 필요해.

Commander: 프로젝트를 설계해볼게요.

     1️⃣ 새 프로젝트 (처음부터)
     2️⃣ 기존 프로젝트에 추가
     ...

You: 1번, Next.js + Prisma + PostgreSQL로

Commander: 기능을 이렇게 분리하면 어떨까요:

     🛡️ Worker #1: 대시보드 — 통계 API + 차트
     🛡️ Worker #2: 칸반보드 — DnD + 상태 관리
     🛡️ Worker #3: 실시간 채팅 — WebSocket + UI
     🛡️ Worker #4: 알림 — 푸시 + 인앱 알림

     QA 전략:
     1️⃣ Worker 자체 유닛 → Commander 통합
     ...

You: 1번으로

Commander: 📋 설계 승인 완료.

     먼저 공통 기반을 구축합니다...
     [auth, db, types, layouts 생성]

     🚀 Worker 4개 동시 파견!

     📊 Worker Dashboard
     | ID  | Feature  | Status      | Duration |
     |-----|----------|-------------|----------|
     | w01 | 대시보드  | 🔍 exploring | 5s       |
     | w02 | 칸반보드  | 🔍 exploring | 4s       |
     | w03 | 채팅     | 🔨 implementing | 12s   |
     | w04 | 알림     | 🔍 exploring | 3s       |

     [████████░░░░░░░░░░░░] 25% — 1/4 completed

     ... (각 Worker가 Scout/Librarian으로 탐색 → 구현 → 자체 QA)

     ✅ 전체 Worker 완료!

     🔍 Conflict Check: ✅ 파일 충돌 없음

     🧪 Final QA Report
     | Type Check | ✅ | tsc --noEmit          |
     | Lint       | ✅ | npm run lint          |
     | Tests      | ✅ | npm test (48 passed)  |

     📦 feat: add project management app with dashboard, kanban, chat, notifications
```

### 단일 기능 (Worker 1개)

```
You: 기존 프로젝트에 2FA 추가해줘, 바로 진행해

Commander: (설계 스킵)
     🚀 Worker 1개 파견: 2FA 구현
     ... 완료 ... QA 통과 ... 커밋
```

---

## 에이전트 구성

```
Commander (primary, 1개)
   ├── Worker#1 (subagent) ──┬── Scout (bg, read-only)
   │                         └── Librarian (bg, read-only)
   ├── Worker#2 (subagent) ──┬── Scout
   │                         └── Librarian
   ├── Worker#3 ...
   └── Worker#N (최대 8)
```

| Agent | 역할 | 권한 | 실행 |
|-------|------|------|------|
| **Commander** | 설계, 분배, 통합, 최종 QA | 전체 | Foreground |
| **Worker** | 기능별 독립 구현 | 스코프 내 read+write | Background |
| **Scout** | 코드 탐색 | read-only | Background |
| **Librarian** | 문서 연구 | read-only | Background |

---

## 7단계 워크플로우

```
DESIGN ─→ FOUNDATION ─→ DISPATCH ─→ MONITORING ─→ INTEGRATE ─→ FINAL-QA ─→ DONE
  │            │             │            │             │            │         │
설계대화     공통모듈       Worker      상태추적       충돌검증     전체QA    커밋
(선택지)     구축          N개 동시     대시보드       diff리뷰    강제      보고
                           파견
```

각 단계는 **플러그인 훅이 강제**합니다:
- 설계 안 하면 → Worker 파견 차단
- Worker 미완료 → 완료 선언 차단
- QA 미실행 → 커밋 차단
- QA 실패 → Worker 재파견 유도

---

## 충돌 방지 시스템

```
Worker#1: src/dashboard/**, src/api/stats/**     ← 독점
Worker#2: src/board/**, src/api/posts/**          ← 독점
Worker#3: src/chat/**, src/api/chat/**            ← 독점
공유(읽기만): src/lib/**, src/types/**             ← 모두 읽기 가능
```

1. `dispatch_workers`가 **스코프 겹침을 자동 검증** (겹치면 거부)
2. `check_conflicts`가 **git diff로 이중 검증** (통합 전)
3. Worker 프롬프트에 스코프 명시 (프롬프트 수준 제약)

---

## vLLM 동시 실행 수학

```
Qwen3-Coder-Next 80B (MoE)
  - 전체 파라미터: 80B
  - 토큰당 활성: ~3B (MoE 전문가 라우팅)
  - H200 141GB HBM3e

동시 세션 VRAM 추정:
  - 모델 가중치 (FP8): ~40GB
  - KV Cache per session (128K ctx): ~2-4GB
  - 16 sessions × 3GB avg = ~48GB
  - Total: ~88GB (H200 141GB 내 여유)

→ Worker 8개 + Scout 8개 + Commander 1개 = 17세션도 가능
```

---

## 설정

### vLLM 주소
```jsonc
// opencode.json
"baseURL": "http://gpu-server.internal:8001/v1"
```

### 동시 실행 수
```bash
AEGIS_BATCH=24 ./scripts/start-vllm.sh   # 대규모 스웜
```

### Worker 최대 수
플러그인에서 `dispatch_workers` 호출 시 최대 8개 제한. 변경하려면:
```typescript
// aegis-plugin.ts
if (specs.length > 8) return "❌ Maximum 8 workers";
// → 원하는 수로 변경
```

### MCP 추가
```jsonc
"mcp": {
  "exa-search": { "type": "stdio", "command": "npx", "args": ["-y", "@anthropic-ai/exa-mcp"] }
}
```

---

## 보안

```
┌───────────────────────────────────────────┐
│              사내 네트워크                  │
│                                           │
│  개발자 ←→ OpenCode ←→ vLLM (H200)       │
│      ↕                    ↕               │
│  Commander  Worker×N  Scout  Librarian    │
│                                           │
│  ════ 이 경계를 절대 넘지 않음 ════         │
└───────────────────────────────────────────┘
          ↕ ❌ 차단
┌───────────────────────────────────────────┐
│  외부 인터넷 (OpenAI/Anthropic/Google)    │
└───────────────────────────────────────────┘
```

---

## 발전시키기

`CLAUDE.md`에 개발 가이드, 로드맵, 디버깅 가이드, 테스트 시나리오가 있습니다.

## 라이선스

MIT
