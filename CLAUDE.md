# CLAUDE.md — Aegis v3 Development Guide

> AI 에이전트가 이 프로젝트를 이해하고 발전시키기 위한 컨텍스트.

---

## 현재 버전: 3.1.2

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

## 버전 관리

### 규칙

- **npm에 publish된 버전은 재사용 불가** — 같은 버전 번호로 다시 publish하면 `E403` 에러
- **패치 변경** (버그 수정, doctor 개선 등): `3.1.0` → `3.1.1`
- **기능 추가** (새 에이전트, 새 도구 등): `3.1.x` → `3.2.0`
- **브레이킹 체인지** (config 스키마 변경, API 변경): `3.x.y` → `4.0.0`
- `package.json`의 `version` 필드를 수정 후 `npm run build && npm publish --access public`
- publish 전 반드시 `npm run typecheck` 통과 확인

### Publish 체크리스트

```bash
npm run typecheck          # 타입 에러 없는지 확인
npm run build              # dist/ 생성
npm publish --access public # npm에 배포
npm install -g oh-my-qwencoder@<version>  # 글로벌 설치 테스트
oh-my-qwencoder doctor     # 헬스체크
```

### 변경 이력

| 버전 | 변경 내용 |
|------|-----------|
| **3.1.2** | Config 우선순위 버그 수정 — `loader.ts` 딥 머지, `install.ts` 프로젝트 config 동기화, `doctor.ts` 양쪽 config + effective 표시 + stale 경고, `--version` CLI 지원 |
| **3.1.1** | `doctor.ts` — 글로벌 config 체크 지원, enabled 상태 표시, 에러/경고 구분 |
| **3.1.0** | 인터랙티브 `install` (readline/promises), `enabled` 필드 추가, provider 주입 가드, 글로벌 config 등록 |
| **3.0.0** | 초기 릴리스 — Commander/Worker/Scout/Librarian 에이전트, 7단계 라이프사이클, 20개 커스텀 도구 |

---

## 설치 및 설정

### 설치 플로우

```bash
npm install -g oh-my-qwencoder    # 1. 글로벌 설치
oh-my-qwencoder install            # 2. 인터랙티브 설정
opencode                           # 3. 실행
```

### `oh-my-qwencoder install`이 하는 일

1. Aegis 배너 표시
2. vLLM/llama.cpp 서버 유무 질문 (readline/promises)
3. Yes → base_url, api_key, model_id, model_name, context_window, max_tokens 입력
4. 연결 테스트 (`GET {baseURL}/models`, 10초 타임아웃)
5. `~/.config/opencode/oh-my-qwencoder.json` 작성 (`enabled: true/false`)
6. 프로젝트 `.opencode/oh-my-qwencoder.json`이 존재하면 같은 내용으로 동기화 (v3.1.2+)
7. `~/.config/opencode/opencode.json`의 `plugin` 배열에 `"oh-my-qwencoder"` 추가
8. 프로젝트 레벨 `opencode.json`이 있으면 거기에도 등록

### Config 경로 및 머지 전략

| 우선순위 | 경로 | 설명 |
|---------|------|------|
| 1 (높음) | `{project}/.opencode/oh-my-qwencoder.json` | 프로젝트 레벨 |
| 2 (낮음) | `~/.config/opencode/oh-my-qwencoder.json` | 글로벌 (install이 생성) |

**딥 머지 (v3.1.2+)**: `loader.ts`는 중첩 객체를 필드 단위로 머지합니다. 예를 들어 글로벌에 `vllm.enabled: true`가 있고 프로젝트에 `vllm.baseURL`만 있으면 두 필드가 공존합니다. 얕은 머지(`{...global, ...project}`)가 아닌 `vllm` 객체 내부까지 머지합니다.

### `enabled` 필드의 역할

- `vllm.enabled: false` → `provider.ts`에서 provider/agent/MCP 주입 **전부 스킵**
- 이로써 vLLM 서버 없이도 opencode가 검은화면 없이 정상 실행됨
- 서버 준비 후 `oh-my-qwencoder install` 재실행하면 `enabled: true`로 전환

### `oh-my-qwencoder doctor`가 체크하는 것

1. 플러그인 등록 여부 (글로벌 + 프로젝트 opencode.json)
2. Config 파일 존재 여부 — 글로벌/프로젝트 **각각** 표시 (enabled, endpoint)
3. Stale 프로젝트 config 경고 — `enabled` 필드 없는 v3.0.0 형식이면 경고
4. **Effective config** (딥 머지 결과) 표시 — 양쪽 config가 모두 있을 때
5. vLLM 서버 연결 (effective config의 `enabled: true`일 때만)
6. opencode CLI 설치 여부

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
│   │   ├── schema.ts               # Zod schema (VllmConfig.enabled 포함)
│   │   ├── loader.ts               # Load + deep merge user/project config (exports findConfigPaths, loadJsonFile)
│   │   └── provider.ts             # vLLM provider config factory (enabled 가드)
│   └── cli/
│       ├── index.ts                # install, doctor, start-vllm, version
│       ├── install.ts              # 인터랙티브 설치 (readline/promises)
│       └── doctor.ts               # 글로벌+프로젝트 헬스체크
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

### ✅ 완료 (v3.1.x)

- ~~인터랙티브 설치~~ → `oh-my-qwencoder install` (readline/promises)
- ~~글로벌 config 등록~~ → `~/.config/opencode/opencode.json` + `oh-my-qwencoder.json`
- ~~vLLM 없을 때 검은화면~~ → `enabled: false` 가드
- ~~doctor 글로벌 config 미체크~~ → 글로벌 + 프로젝트 모두 체크
- ~~Config 얕은 머지로 `enabled` 유실~~ → 딥 머지 (v3.1.2)
- ~~install이 프로젝트 config 미갱신~~ → 프로젝트 config 동기화 (v3.1.2)
- ~~doctor가 머지 결과 미표시~~ → effective config + stale 경고 (v3.1.2)
- ~~`--version` 미지원~~ → `oh-my-qwencoder --version` (v3.1.2)

### 🟢 단기 (v3.2.x)

1. **Worker 진행률 실시간 스트리밍** — Worker 내부 TODO를 Commander에게 전파
2. **자동 스코프 추천** — `project_overview` 결과 기반 디렉토리 분배 제안
3. **Worker 간 의존성 순서** — "Worker#2는 Worker#1 완료 후 시작" 지원
4. **슬래시 커맨드** — `/status`, `/workers`, `/retry w01`, `/qa`
5. **llama.cpp 네이티브 지원** — vLLM 외 llama.cpp/Ollama 서버 자동 감지

### 🟡 중기 (v3.3.x ~ v3.5.x)

6. **Git 브랜치 분리** — 각 Worker가 feature 브랜치에서 작업, Commander가 머지
7. **Worker 결과 캐시** — 파일 저장으로 세션 재시작 시 복구
8. **동적 Worker 수 조절** — vLLM 부하 모니터링 기반 (`/metrics` 폴링)
9. **Inspector 에이전트** — QA 전담 서브에이전트 (테스트 작성 특화)
10. **멀티 프로바이더** — vLLM + Ollama + OpenAI 동시 사용 (Worker별 다른 모델)

### 🔴 장기 (v4.x)

11. **멀티 GPU** — `--tensor-parallel-size 2+`로 256K 컨텍스트 + 더 많은 Worker
12. **프로젝트 메모리** — 이전 세션의 설계/패턴을 SQLite에 저장
13. **CI/CD 연동** — Worker 완료 → 자동 PR 생성 → CI 결과 피드백
14. **Web UI 대시보드** — Worker 실시간 상태를 브라우저에서 모니터링
15. **원격 Worker** — SSH/Docker를 통한 분산 Worker 실행

---

## 디버깅 가이드

### opencode 실행 시 검은화면
- `~/.config/opencode/oh-my-qwencoder.json`에서 `vllm.enabled` 확인
- `enabled: true`인데 서버가 죽었으면 검은화면 발생
- 해결: 서버 재시작 또는 `oh-my-qwencoder install` → 서버 없음 선택 (disabled로 전환)

### npm publish 403 에러
- 이미 publish된 버전을 다시 publish하면 발생
- `package.json`의 `version`을 올린 후 다시 시도
- 패치: `x.y.z+1`, 기능: `x.y+1.0`, 브레이킹: `x+1.0.0`

### 플러그인이 opencode에서 인식 안 됨
- `oh-my-qwencoder doctor`로 등록 상태 확인
- `~/.config/opencode/opencode.json`의 `plugin` 배열에 `"oh-my-qwencoder"` 있는지 확인
- 없으면 `oh-my-qwencoder install` 재실행

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
