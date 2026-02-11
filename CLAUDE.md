# CLAUDE.md — Aegis v3 Development Guide

> AI 에이전트가 이 프로젝트를 이해하고 발전시키기 위한 컨텍스트.

---

## 한 줄 요약

**Aegis v3**는 하나의 자체호스팅 LLM(Qwen3-Coder-Next)으로 Commander가 설계하고, 여러 Worker가 기능별로 병렬 개발하고, Commander가 통합 QA하는 **개발 스웜** 플러그인입니다.

---

## 아키텍처

```
                         사용자
                           │
                    ┌──────▼──────┐
                    │  Commander  │  설계 + 분배 + 통합 QA
                    │  (primary)  │
                    └──┬───┬───┬──┘
              ┌────────┘   │   └────────┐
         ┌────▼────┐ ┌────▼────┐ ┌─────▼────┐
         │Worker#1 │ │Worker#2 │ │Worker#3  │  기능별 독립 구현
         │대시보드   │ │게시판    │ │결제      │
         ├─────────┤ ├─────────┤ ├──────────┤
         │Scout    │ │Scout    │ │Scout     │  코드 탐색 (bg)
         │Librarian│ │Librarian│ │Librarian │  문서 연구 (bg)
         └─────────┘ └─────────┘ └──────────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼──────┐
                    │   vLLM      │  단일 모델, 동시 16요청
                    │ Qwen3-Coder │  MoE: 3B active/token
                    │   H200      │
                    └─────────────┘
```

### 핵심 원리

1. **같은 모델, 다른 역할**: Commander/Worker/Scout/Librarian 모두 Qwen3-Coder-Next. 시스템 프롬프트로 전문화.
2. **vLLM concurrent inference**: `--max-num-seqs 16`으로 동시 16세션. MoE라 VRAM 효율적.
3. **파일 스코프 분리**: 각 Worker에게 독점 디렉토리 할당 → 충돌 방지.
4. **계층적 QA**: Worker 자체 QA → Commander 통합 QA → 실패 시 Worker 재파견.

### oh-my-opencode와의 차이

| | oh-my-opencode | Aegis v3 |
|---|---|---|
| 모델 | 5개 프로바이더 7개 모델 | **1개 모델** |
| 병렬화 목적 | 모델별 비용 최적화 | **기능별 속도 극대화** |
| 개발 단위 | 에이전트가 전체를 개발 | **Worker가 기능별 독립 개발** |
| 분배 | Sisyphus가 도구별 위임 | **Commander가 기능별 위임** |
| QA | 프롬프트 수준 권고 | **stop 훅으로 강제** |
| 데이터 | 5개 외부 API | **사내 완전 격리** |

---

## 파일 구조

```
oh-my-qwencoder/                    # repo root = npm package
├── package.json                    # name: "oh-my-qwencoder", bin, exports
├── tsconfig.json
├── src/
│   ├── index.ts                    # Plugin factory (default export)
│   ├── agents/
│   │   ├── index.ts                # re-export all
│   │   ├── commander.ts            # prompt string + config factory
│   │   ├── worker.ts
│   │   ├── scout.ts
│   │   └── librarian.ts
│   ├── tools/
│   │   ├── index.ts
│   │   ├── session.ts              # AegisSession types + state mgmt
│   │   ├── design.ts               # design_approve
│   │   ├── worker-management.ts    # dispatch/status/output/retry
│   │   ├── background.ts           # background_task/output
│   │   ├── code-intelligence.ts    # project_overview/find_references/ast_grep
│   │   ├── git.ts                  # git_status/diff/log/commit
│   │   └── qa.ts                   # qa_run/check_conflicts
│   ├── hooks/
│   │   ├── index.ts
│   │   ├── chat-message.ts         # Phase injection + auto-transition
│   │   ├── tool-execute-after.ts   # File tracking
│   │   ├── stop.ts                 # Completion guard
│   │   ├── session-compacting.ts   # Context preservation
│   │   └── event.ts                # Session lifecycle
│   ├── config/
│   │   ├── schema.ts               # Zod schema for oh-my-qwencoder.json
│   │   ├── loader.ts               # Load + merge user/project config
│   │   └── provider.ts             # vLLM provider config factory
│   └── cli/
│       ├── index.ts                # install, doctor, start-vllm
│       ├── install.ts              # Interactive installer
│       └── doctor.ts               # Health checks
├── bin/
│   └── oh-my-qwencoder.js          # CLI entry point
├── scripts/
│   └── start-vllm.sh               # vLLM launcher
├── CLAUDE.md
└── README.md
```

---

## 에이전트 계층

| Agent | Mode | 권한 | 생성 | 수 |
|-------|------|------|------|---|
| **Commander** | primary | 전체 (read+write+delegate) | 시작 시 1개 | 1 |
| **Worker** | subagent | scope 내 read+write | Commander가 동적 생성 | 1~8 |
| **Scout** | subagent | read-only | Worker/Commander가 bg 생성 | N |
| **Librarian** | subagent | read-only | Worker/Commander가 bg 생성 | N |

### 동시 세션 수 계산 (최대)
```
Commander    ×1 = 1
Workers      ×4 = 4    (기능 4개 병렬)
Scout/Lib    ×8 = 8    (각 Worker가 2개씩)
─────────────────────
Total        = 13 sessions (max-num-seqs=16 내)
```

---

## 7단계 라이프사이클

```
DESIGN → FOUNDATION → DISPATCH → MONITORING → INTEGRATE → FINAL-QA → DONE
```

| Phase | 주체 | 설명 | 도구 |
|-------|------|------|------|
| **design** | Commander ↔ 사용자 | 기능 분해 + 스코프 + QA 전략 | `design_approve` |
| **foundation** | Commander | 공통 모듈(auth, db, types) 구축 | 직접 코딩 |
| **dispatch** | Commander | Worker N개 동시 파견 | `dispatch_workers` |
| **monitoring** | Commander | Worker 상태 추적 | `worker_status`, `worker_output` |
| **integrate** | Commander | 충돌 확인 + 결과 리뷰 | `check_conflicts` |
| **final-qa** | Commander | 전체 프로젝트 QA | `qa_run` |
| **done** | Commander | 커밋 + 보고 | `git_commit` |

### 훅 강제 메커니즘

| Hook | 동작 |
|------|------|
| `chat.message` | 현재 phase에 맞는 지시를 system prompt에 주입 |
| `chat.message` | monitoring에서 전 Worker 완료 시 자동으로 integrate 전환 |
| `tool.execute.after` | 파일 수정 추적 |
| `stop` | Worker 미완료/QA 미실행/QA 실패 시 완료 차단 |
| `session.compacting` | Worker 결과 + 설계 요약 프롬프트에 보존 |

---

## 커스텀 도구 (20개)

| 카테고리 | 도구 | 설명 |
|---------|------|------|
| **Worker Mgmt** | `dispatch_workers` | Worker N개 동시 파견 (스코프 충돌 검증) |
| | `worker_status` | 전체 Worker 대시보드 |
| | `worker_output` | 개별 Worker 결과 수집 |
| | `worker_retry` | 실패 Worker 재파견 (추가 지시) |
| **Background** | `background_task` | Scout/Librarian bg 실행 |
| | `background_output` | bg 결과 수집 |
| **Design** | `design_approve` | 설계 승인 + QA 전략 |
| **Code Intel** | `project_overview` | 프로젝트 분석 |
| | `find_references` | 심볼 참조 |
| | `ast_grep_search` | AST 구조 검색 |
| **Git** | `git_status`, `git_diff`, `git_log`, `git_commit` | Git |
| **QA** | `qa_run` | 전체 QA 스위트 |
| **Safety** | `check_conflicts` | Worker간 파일 충돌 검증 |

---

## Worker 파일 스코프 시스템

**충돌 방지의 핵심**: 각 Worker에게 독점 디렉토리를 할당합니다.

```json
{
  "name": "대시보드",
  "fileScope": ["src/dashboard/**", "src/api/stats/**"],
  "sharedReadOnly": ["src/lib/**", "src/types/**"]
}
```

- `fileScope`: Worker가 수정할 수 있는 범위 (독점)
- `sharedReadOnly`: 읽을 수 있지만 수정 불가
- `dispatch_workers`가 스코프 겹침을 **자동 검증** (겹치면 거부)
- `check_conflicts`가 통합 전 실제 git diff로 **이중 검증**

### Worker가 공유 모듈을 수정해야 하는 경우
Worker는 공유 모듈(src/lib, src/types 등)을 수정할 수 없습니다. 수정이 필요하면:
1. Worker가 보고서에 "공유 모듈 X에 Y 변경 필요" 기재
2. Commander가 직접 수정
3. 필요시 영향받는 Worker들에게 `worker_retry`

---

## 개선 로드맵

### 🟢 단기

1. **Worker 진행률 실시간 스트리밍** — Worker 내부 TODO를 Commander에게 전파
2. **자동 스코프 추천** — `project_overview` 결과 기반 디렉토리 분배 제안
3. **Worker 간 의존성 순서** — "Worker#2는 Worker#1 완료 후 시작" 지원
4. **슬래시 커맨드** — `/status`, `/workers`, `/retry w01`, `/qa`

### 🟡 중기

5. **Git 브랜치 분리** — 각 Worker가 feature 브랜치에서 작업, Commander가 머지
6. **Worker 결과 캐시** — 파일 저장으로 세션 재시작 시 복구
7. **동적 Worker 수 조절** — vLLM 부하 모니터링 기반
8. **Inspector 에이전트** — QA 전담 서브에이전트 (테스트 작성 특화)

### 🔴 장기

9. **멀티 GPU** — `--tensor-parallel-size 2+`로 256K 컨텍스트 + 더 많은 Worker
10. **프로젝트 메모리** — 이전 세션의 설계/패턴을 SQLite에 저장
11. **CI/CD 연동** — Worker 완료 → 자동 PR 생성 → CI 결과 피드백
12. **Web UI 대시보드** — Worker 실시간 상태를 브라우저에서 모니터링

---

## 디버깅 가이드

### Worker가 실행되지 않을 때
```bash
# vLLM 동시 요청 확인
curl -s http://localhost:8001/metrics | grep vllm:num_requests
# max-num-seqs가 Worker 수 + Scout/Lib 수보다 큰지 확인
```

### Worker가 스코프 밖 파일을 수정했을 때
- Worker 프롬프트에 스코프가 명시되어 있지만, 현재는 프롬프트 수준 강제
- 강화 방법: `tool.execute.before` 훅에서 edit/write의 filePath를 스코프와 대조하여 차단
- `check_conflicts`로 사후 검증

### 컨텍스트 압축 후 Worker 상태 유실
- `experimental.session.compacting` 훅이 Worker ID, 상태, 결과 요약을 프롬프트에 주입
- 긴 결과는 잘림 (150자) → 중요 정보는 Worker Report 형식으로 상단에 배치되도록 Worker 프롬프트에 지시

### Worker 무한 루프
- Worker의 `task: false` 설정으로 다른 Worker 스폰 방지
- Scout/Librarian의 `task: false`로 재귀 방지
- `dispatch_workers`에서 최대 8 Worker 제한

---

## 테스트 시나리오

### 1. 기본 플로우
```
1. "블로그 서비스 만들어줘" 입력
2. Commander가 설계 인터뷰 시작 (선택지 제공)
3. 기능 분해: 게시판, 댓글, 사용자 프로필, 관리자
4. 설계 승인 → Foundation 구축
5. Worker 4개 dispatch
6. 전체 완료 → check_conflicts → qa_run → commit
```

### 2. Worker 실패 + 재파견
```
1. Worker#2 (댓글) QA 실패
2. Commander가 worker_output으로 에러 확인
3. worker_retry(w02, "타입 에러 수정: Comment.author를 string → User로")
4. Worker#2 재실행 → 성공
5. 통합 QA 통과
```

### 3. 단일 기능 (Worker 1개)
```
1. "로그인에 2FA 추가해줘" → 단일 기능
2. Commander가 설계 후 Worker 1개만 dispatch
3. 나머지 플로우 동일
```

---

## 참고 자료

- [OpenCode Agents](https://opencode.ai/docs/agents/) — subagent mode, hidden, task tool
- [OpenCode Plugins](https://opencode.ai/docs/plugins/) — lifecycle hooks, custom tools
- [oh-my-opencode](https://deepwiki.com/code-yeongyu/oh-my-opencode) — 참고 아키텍처
- [oh-my-opencode Background Tasks](https://deepwiki.com/code-yeongyu/oh-my-opencode/5.3-background-task-tools) — bg 패턴
- [opencode-background-agents](https://github.com/kdcokenny/opencode-background-agents) — 커뮤니티 bg 플러그인
- [OpenCode Background Agent Issue](https://github.com/anomalyco/opencode/issues/5887) — 비동기 위임 RFC
