import { type Plugin, tool } from "@opencode-ai/plugin";

// ═══════════════════════════════════════════════════════════════
//  Aegis Plugin v3 — Parallel Development Swarm
//
//  Commander (primary)
//    ├── Worker #1 "대시보드" ──┬── Scout (bg)
//    │                         └── Librarian (bg)
//    ├── Worker #2 "게시판"   ──┬── Scout (bg)
//    │                         └── Librarian (bg)
//    └── ...
//
//  All agents: same Qwen3-Coder-Next on private vLLM.
//  MoE 3B active/token → 10+ concurrent sessions feasible.
// ═══════════════════════════════════════════════════════════════

// ─── Types ───────────────────────────────────────────────────

type CommanderPhase =
  | "design"
  | "foundation"
  | "dispatch"
  | "monitoring"
  | "integrate"
  | "final-qa"
  | "done";

interface QAStrategy {
  workerSelfQA: boolean;
  unitTest: boolean;
  integrationTest: boolean;
  e2eTest: boolean;
  typeCheck: boolean;
  lint: boolean;
}

interface WorkerSpec {
  name: string;
  feature: string;
  fileScope: string[];       // dirs/files this worker can touch
  sharedReadOnly: string[];  // dirs/files worker can read but not modify
  spec: string;              // detailed feature specification
  qaRequirements: string;    // what tests to pass
}

interface WorkerInstance {
  id: string;
  spec: WorkerSpec;
  status: "pending" | "exploring" | "implementing" | "self-qa" | "completed" | "failed" | "retry";
  result: string;
  startedAt: number;
  completedAt?: number;
  retryCount: number;
  sessionId?: string;
}

interface BackgroundTask {
  id: string;
  agent: string;
  prompt: string;
  status: "pending" | "running" | "completed" | "failed";
  result: string;
  startedAt: number;
  completedAt?: number;
}

interface AegisSession {
  phase: CommanderPhase;
  designApproved: boolean;
  designSummary: string;
  qaStrategy: QAStrategy;
  workers: Map<string, WorkerInstance>;
  workerCounter: number;
  backgroundTasks: Map<string, BackgroundTask>;
  bgCounter: number;
  filesModified: string[];
  qaResults: Record<string, "pass" | "fail" | "skip">;
  explorationCount: number;
}

const sessions = new Map<string, AegisSession>();

function getSession(sid: string): AegisSession {
  let s = sessions.get(sid);
  if (!s) {
    s = {
      phase: "design",
      designApproved: false,
      designSummary: "",
      qaStrategy: {
        workerSelfQA: true,
        unitTest: true,
        integrationTest: true,
        e2eTest: false,
        typeCheck: true,
        lint: true,
      },
      workers: new Map(),
      workerCounter: 0,
      backgroundTasks: new Map(),
      bgCounter: 0,
      filesModified: [],
      qaResults: {},
      explorationCount: 0,
    };
    sessions.set(sid, s);
  }
  return s;
}

function genWorkerId(s: AegisSession): string {
  s.workerCounter++;
  return `w${String(s.workerCounter).padStart(2, "0")}`;
}

function genBgId(s: AegisSession): string {
  s.bgCounter++;
  return `bg_${String(s.bgCounter).padStart(2, "0")}`;
}

function workerStatusTable(workers: Map<string, WorkerInstance>): string {
  if (workers.size === 0) return "No workers dispatched.";
  const rows = ["| ID | Feature | Status | Duration | Retries |", "|---|---|---|---|---|"];
  const emojis: Record<string, string> = {
    pending: "⏳", exploring: "🔍", implementing: "🔨",
    "self-qa": "🧪", completed: "✅", failed: "❌", retry: "🔄",
  };
  for (const [id, w] of workers) {
    const dur = w.completedAt
      ? `${Math.round((w.completedAt - w.startedAt) / 1000)}s`
      : `${Math.round((Date.now() - w.startedAt) / 1000)}s`;
    rows.push(`| ${id} | ${w.spec.name} | ${emojis[w.status] || "?"} ${w.status} | ${dur} | ${w.retryCount} |`);
  }

  const done = [...workers.values()].filter((w) => w.status === "completed").length;
  const total = workers.size;
  const pct = Math.round((done / total) * 100);
  const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
  rows.push(`\n[${bar}] ${pct}% — ${done}/${total} completed`);
  return rows.join("\n");
}

// ═══════════════════════════════════════════════════════════════

export const AegisPlugin: Plugin = async ({ client, directory, $ }) => {
  await client.app.log({
    body: { service: "aegis", level: "info", message: `🛡️ Aegis v3 Swarm loaded — ${directory}` },
  });

  // ─── Worker Launcher ───────────────────────────────────
  async function launchWorker(sid: string, workerId: string): Promise<void> {
    const session = getSession(sid);
    const worker = session.workers.get(workerId);
    if (!worker) return;

    worker.status = "exploring";

    const workerPrompt = `
## Your Assignment

**Feature**: ${worker.spec.name}
**Description**: ${worker.spec.feature}

### File Scope (you can modify these)
${worker.spec.fileScope.map((f) => `- \`${f}\``).join("\n")}

### Shared (read-only — do NOT modify)
${worker.spec.sharedReadOnly.map((f) => `- \`${f}\``).join("\n")}

### Specification
${worker.spec.spec}

### QA Requirements
${worker.spec.qaRequirements}

---

Begin by exploring with Scout and Librarian, then implement, then self-QA.
Report back with your structured report when complete.
`;

    try {
      const result = await client.session.prompt({
        agent: "worker",
        prompt: workerPrompt,
      });

      worker.status = "completed";
      worker.result = typeof result === "string" ? result : JSON.stringify(result);
      worker.completedAt = Date.now();

      await client.app.log({
        body: {
          service: "aegis",
          level: "info",
          message: `✅ Worker ${workerId} (${worker.spec.name}) completed in ${Math.round((worker.completedAt - worker.startedAt) / 1000)}s`,
        },
      });
    } catch (err: any) {
      worker.status = "failed";
      worker.result = `Error: ${err?.message || err}`;
      worker.completedAt = Date.now();
    }
  }

  // ─── Background Task Launcher ──────────────────────────
  async function launchBg(sid: string, bgId: string, agent: string, prompt: string): Promise<void> {
    const session = getSession(sid);
    const task = session.backgroundTasks.get(bgId);
    if (!task) return;
    task.status = "running";
    try {
      const result = await client.session.prompt({ agent, prompt });
      task.status = "completed";
      task.result = typeof result === "string" ? result : JSON.stringify(result);
      task.completedAt = Date.now();
    } catch (err: any) {
      task.status = "failed";
      task.result = `Error: ${err?.message || err}`;
      task.completedAt = Date.now();
    }
  }

  return {
    tool: {
      // ═══════════════════════════════════════════════════
      //  DESIGN TOOLS
      // ═══════════════════════════════════════════════════

      design_approve: tool({
        description: "Approve the project design. Transitions to FOUNDATION phase.",
        args: {
          summary: tool.schema.string().describe("Full design summary (markdown)"),
          qa_strategy: tool.schema
            .enum(["worker-self-qa", "commander-all", "worker-unit-commander-integration", "full-e2e"])
            .describe("QA distribution strategy"),
        },
        async execute({ summary, qa_strategy }, ctx) {
          const session = getSession(ctx.sessionID);
          session.designApproved = true;
          session.designSummary = summary;
          session.phase = "foundation";

          const strategies: Record<string, QAStrategy> = {
            "worker-self-qa": { workerSelfQA: true, unitTest: true, integrationTest: false, e2eTest: false, typeCheck: true, lint: true },
            "commander-all": { workerSelfQA: false, unitTest: true, integrationTest: true, e2eTest: false, typeCheck: true, lint: true },
            "worker-unit-commander-integration": { workerSelfQA: true, unitTest: true, integrationTest: true, e2eTest: false, typeCheck: true, lint: true },
            "full-e2e": { workerSelfQA: true, unitTest: true, integrationTest: true, e2eTest: true, typeCheck: true, lint: true },
          };
          session.qaStrategy = strategies[qa_strategy];

          return `✅ Design approved. QA: ${qa_strategy}\n\nNow build the FOUNDATION (shared modules, types, project structure) before dispatching Workers.
Use \`dispatch_workers\` when the foundation is ready.`;
        },
      }),

      // ═══════════════════════════════════════════════════
      //  WORKER MANAGEMENT
      // ═══════════════════════════════════════════════════

      dispatch_workers: tool({
        description: `Dispatch multiple Workers to build features in parallel. Each Worker gets its own session, Scout, and Librarian. Workers run simultaneously via vLLM concurrent inference.

CRITICAL: Define non-overlapping file scopes to prevent conflicts.

Example:
dispatch_workers(workers: '[
  {"name":"대시보드","feature":"Stats API + chart components","fileScope":["src/dashboard/**","src/api/stats/**"],"sharedReadOnly":["src/lib/**","src/types/**"],"spec":"Build dashboard with...","qaRequirements":"npm test -- --grep dashboard"},
  {"name":"게시판","feature":"CRUD API + list/detail pages","fileScope":["src/board/**","src/api/posts/**"],"sharedReadOnly":["src/lib/**"],"spec":"Build board with...","qaRequirements":"npm test -- --grep board"}
]')`,
        args: {
          workers: tool.schema
            .string()
            .describe("JSON array of WorkerSpec objects"),
        },
        async execute({ workers: workersJson }, ctx) {
          const session = getSession(ctx.sessionID);
          let specs: WorkerSpec[];
          try {
            specs = JSON.parse(workersJson);
          } catch (e) {
            return `❌ Invalid JSON. Error: ${e}`;
          }

          if (specs.length === 0) return "❌ No workers specified.";
          if (specs.length > 8) return "❌ Maximum 8 workers (vLLM concurrency limit).";

          // Check for overlapping file scopes
          const allScopes: string[] = [];
          for (const spec of specs) {
            for (const scope of spec.fileScope) {
              const base = scope.replace("/**", "").replace("/*", "");
              if (allScopes.includes(base)) {
                return `❌ Overlapping scope detected: ${base}. Each Worker must have exclusive file scopes.`;
              }
              allScopes.push(base);
            }
          }

          session.phase = "monitoring";

          // Create and launch all workers
          const launched: string[] = [];
          for (const spec of specs) {
            const id = genWorkerId(session);
            const worker: WorkerInstance = {
              id,
              spec,
              status: "pending",
              result: "",
              startedAt: Date.now(),
              retryCount: 0,
            };
            session.workers.set(id, worker);
            launched.push(`🛡️ ${id}: ${spec.name}`);

            // Fire and forget
            launchWorker(ctx.sessionID, id);
          }

          return `🚀 ${specs.length} Workers dispatched!\n\n${launched.join("\n")}\n\nAll running in parallel via vLLM concurrent inference.
Use \`worker_status\` to monitor progress.
Use \`worker_output\` to collect individual results.`;
        },
      }),

      worker_status: tool({
        description: "Show status dashboard of all Workers. Use during MONITORING phase.",
        args: {},
        async execute(_, ctx) {
          const session = getSession(ctx.sessionID);
          return `## 📊 Worker Dashboard\n\n${workerStatusTable(session.workers)}`;
        },
      }),

      worker_output: tool({
        description: "Collect output from a specific Worker. Wait for completion or check immediately.",
        args: {
          worker_id: tool.schema.string().describe("Worker ID (e.g., w01)"),
          wait: tool.schema.boolean().default(false).describe("Wait for completion"),
        },
        async execute({ worker_id, wait }, ctx) {
          const session = getSession(ctx.sessionID);
          const worker = session.workers.get(worker_id);
          if (!worker) return `❌ Worker ${worker_id} not found. Available: ${[...session.workers.keys()].join(", ")}`;

          if (wait && !["completed", "failed"].includes(worker.status)) {
            const timeout = 300_000; // 5min
            const start = Date.now();
            while (Date.now() - start < timeout) {
              if (worker.status === "completed" || worker.status === "failed") break;
              await new Promise((r) => setTimeout(r, 2000));
            }
          }

          const dur = worker.completedAt
            ? `${Math.round((worker.completedAt - worker.startedAt) / 1000)}s`
            : `${Math.round((Date.now() - worker.startedAt) / 1000)}s (running)`;

          let output = `## 🛡️ Worker ${worker_id}: ${worker.spec.name}\n`;
          output += `Status: ${worker.status} | Duration: ${dur} | Retries: ${worker.retryCount}\n`;
          output += `Scope: ${worker.spec.fileScope.join(", ")}\n\n`;

          if (worker.status === "completed" || worker.status === "failed") {
            output += `---\n${worker.result}`;
          } else {
            output += `(Still ${worker.status}. Use wait=true or check back later.)`;
          }
          return output;
        },
      }),

      worker_retry: tool({
        description: "Send a failed or completed Worker back to fix issues. Provide additional instructions.",
        args: {
          worker_id: tool.schema.string().describe("Worker ID"),
          instructions: tool.schema.string().describe("What to fix or improve"),
        },
        async execute({ worker_id, instructions }, ctx) {
          const session = getSession(ctx.sessionID);
          const worker = session.workers.get(worker_id);
          if (!worker) return `❌ Worker ${worker_id} not found.`;

          worker.status = "retry";
          worker.retryCount++;
          worker.result = "";
          worker.startedAt = Date.now();
          worker.completedAt = undefined;

          // Relaunch with additional instructions
          const retrySpec = { ...worker.spec };
          retrySpec.spec += `\n\n## 🔄 Retry Instructions (from Commander)\n${instructions}`;
          worker.spec = retrySpec;

          launchWorker(ctx.sessionID, worker_id);

          return `🔄 Worker ${worker_id} (${worker.spec.name}) retrying. Attempt #${worker.retryCount + 1}\nInstructions: ${instructions}`;
        },
      }),

      // ═══════════════════════════════════════════════════
      //  BACKGROUND TASKS (Scout/Librarian for Commander)
      // ═══════════════════════════════════════════════════

      background_task: tool({
        description: "Launch Scout/Librarian background task (for Commander's own exploration).",
        args: {
          agent: tool.schema.enum(["scout", "librarian"]),
          prompt: tool.schema.string(),
        },
        async execute({ agent, prompt }, ctx) {
          const session = getSession(ctx.sessionID);
          const id = genBgId(session);
          session.backgroundTasks.set(id, {
            id, agent, prompt, status: "pending", result: "", startedAt: Date.now(),
          });
          session.explorationCount++;
          launchBg(ctx.sessionID, id, agent, prompt);
          return `${agent === "scout" ? "🔍" : "📚"} Background ${id}: ${agent} launched.\nUse \`background_output(task_id="${id}")\` to collect.`;
        },
      }),

      background_output: tool({
        description: "Collect background task result.",
        args: {
          task_id: tool.schema.string(),
          wait: tool.schema.boolean().default(false),
        },
        async execute({ task_id, wait }, ctx) {
          const session = getSession(ctx.sessionID);
          const task = session.backgroundTasks.get(task_id);
          if (!task) return `❌ Task ${task_id} not found.`;
          if (wait && !["completed", "failed"].includes(task.status)) {
            const start = Date.now();
            while (Date.now() - start < 60_000) {
              if (task.status === "completed" || task.status === "failed") break;
              await new Promise((r) => setTimeout(r, 1000));
            }
          }
          const emoji = { pending: "⏳", running: "🔄", completed: "✅", failed: "❌" }[task.status] || "?";
          let out = `${emoji} ${task_id} (${task.agent}): ${task.status}\n`;
          if (task.result) out += `---\n${task.result}`;
          return out;
        },
      }),

      // ═══════════════════════════════════════════════════
      //  CODE INTELLIGENCE
      // ═══════════════════════════════════════════════════

      project_overview: tool({
        description: "Analyze project structure and tech stack.",
        args: {},
        async execute(_, ctx) {
          getSession(ctx.sessionID).explorationCount++;
          const parts: string[] = [];
          try {
            parts.push(`## Structure\n\`\`\`\n${await $`find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/__pycache__/*' | sort | head -100`.text()}\n\`\`\``);
          } catch {}
          const configs: Record<string, string> = {
            "package.json": "Node.js", "tsconfig.json": "TypeScript", "pyproject.toml": "Python",
            "Cargo.toml": "Rust", "go.mod": "Go", "docker-compose.yml": "Docker",
          };
          const found: string[] = [];
          for (const [f, s] of Object.entries(configs)) {
            try { await $`test -e ${f}`.text(); found.push(`- **${s}** (${f})`); } catch {}
          }
          if (found.length) parts.push(`## Stack\n${found.join("\n")}`);
          try {
            const pkg = JSON.parse(await $`cat package.json`.text());
            if (pkg.scripts) parts.push(`## Scripts\n\`\`\`\n${Object.entries(pkg.scripts).map(([k, v]) => `${k}: ${v}`).join("\n")}\n\`\`\``);
          } catch {}
          try {
            const b = await $`git branch --show-current`.text();
            parts.push(`## Git\nBranch: ${b.trim()}\n${await $`git log --oneline -5`.text()}`);
          } catch {}
          return parts.join("\n\n") || "Could not analyze";
        },
      }),

      find_references: tool({
        description: "Find symbol references across codebase",
        args: { symbol: tool.schema.string(), pattern: tool.schema.string().default("*") },
        async execute({ symbol, pattern }, ctx) {
          getSession(ctx.sessionID).explorationCount++;
          try {
            const inc = pattern !== "*" ? `--include="${pattern}"` : "";
            return await $`sh -c 'grep -rn ${inc} --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git "${symbol}" . | head -60'`.text() || "No refs";
          } catch { return "No refs"; }
        },
      }),

      ast_grep_search: tool({
        description: "AST structural search. e.g. 'console.log($$$)'",
        args: {
          pattern: tool.schema.string(),
          lang: tool.schema.enum(["typescript", "javascript", "python", "rust", "go", "java"]),
          path: tool.schema.string().default("."),
        },
        async execute({ pattern, lang, path }) {
          try {
            return await $`sg scan --pattern "${pattern}" --lang ${lang} ${path} 2>/dev/null | head -80`.text() || "No matches";
          } catch { return "ast-grep not installed. npm i -g @ast-grep/cli"; }
        },
      }),

      // ═══════════════════════════════════════════════════
      //  GIT
      // ═══════════════════════════════════════════════════

      git_status: tool({
        description: "Git status",
        args: {},
        async execute() {
          try { return `🔀 ${(await $`git branch --show-current`.text()).trim()}\n${await $`git status --short`.text() || "Clean"}`; }
          catch { return "Not a git repo"; }
        },
      }),

      git_diff: tool({
        description: "Show diff",
        args: { staged: tool.schema.boolean().default(false), file: tool.schema.string().optional() },
        async execute({ staged, file }) {
          try { return await $`sh -c 'git diff ${staged ? "--staged" : ""} ${file || ""} | head -300'`.text() || "No changes"; }
          catch { return "Failed"; }
        },
      }),

      git_log: tool({
        description: "Git history",
        args: { count: tool.schema.number().default(10), search: tool.schema.string().optional() },
        async execute({ count, search }) {
          try {
            const sf = search ? `-S "${search}"` : "";
            return await $`sh -c 'git log --oneline -${count} ${sf}'`.text() || "No commits";
          } catch { return "Failed"; }
        },
      }),

      git_commit: tool({
        description: "Atomic commit",
        args: { message: tool.schema.string(), files: tool.schema.string().optional() },
        async execute({ message, files }) {
          try {
            await $`sh -c '${files ? `git add ${files}` : "git add -A"}'`.text();
            return `📦 ${await $`git commit -m "${message}"`.text()}`;
          } catch (e) { return `Failed: ${e}`; }
        },
      }),

      // ═══════════════════════════════════════════════════
      //  QA
      // ═══════════════════════════════════════════════════

      qa_run: tool({
        description: "Run full project QA. Commander uses this for final integration QA after all Workers complete.",
        args: {
          test_cmd: tool.schema.string().optional(),
          lint_cmd: tool.schema.string().optional(),
          typecheck_cmd: tool.schema.string().optional(),
        },
        async execute({ test_cmd, lint_cmd, typecheck_cmd }, ctx) {
          const session = getSession(ctx.sessionID);
          const rows: string[] = ["## 🧪 Final QA Report\n", "| Check | Status | Command |", "|-------|--------|---------|"];

          let tc = test_cmd, lc = lint_cmd, cc = typecheck_cmd;
          if (!tc || !lc || !cc) {
            try {
              const s = JSON.parse(await $`cat package.json`.text()).scripts || {};
              if (!tc) tc = s.test ? "npm test" : undefined;
              if (!lc) lc = s.lint ? "npm run lint" : undefined;
              if (!cc) cc = s.typecheck ? "npm run typecheck" : undefined;
            } catch {}
            if (!tc) { try { await $`test -f Cargo.toml`.text(); tc = "cargo test"; cc = cc || "cargo check"; lc = lc || "cargo clippy"; } catch {} }
            if (!cc) { try { await $`test -f tsconfig.json`.text(); cc = "npx tsc --noEmit"; } catch {} }
          }

          for (const [name, cmd, key] of [["Type Check", cc, "typecheck"], ["Lint", lc, "lint"], ["Tests", tc, "test"]] as const) {
            if (!cmd) continue;
            try {
              await $`sh -c '${cmd} 2>&1'`.text();
              session.qaResults[key] = "pass";
              rows.push(`| ${name} | ✅ | \`${cmd}\` |`);
            } catch (e: any) {
              session.qaResults[key] = "fail";
              rows.push(`| ${name} | ❌ | \`${cmd}\` |`);
              rows.push(`\n\`\`\`\n${String(e?.stdout || e).substring(0, 400)}\n\`\`\`\n`);
            }
          }

          try { rows.push(`\n### Changes\n\`\`\`\n${await $`git diff --stat`.text()}\n\`\`\``); } catch {}

          const hasFail = Object.values(session.qaResults).includes("fail");
          rows.push(hasFail ? "\n⚠️ **QA 실패.** 해당 Worker에게 `worker_retry`로 수정 지시." : "\n✅ **전체 QA 통과.** 커밋 준비 완료.");
          if (!hasFail) session.phase = "done";
          return rows.join("\n");
        },
      }),

      // ═══════════════════════════════════════════════════
      //  CONFLICT CHECK
      // ═══════════════════════════════════════════════════

      check_conflicts: tool({
        description: "Check for file conflicts between Workers. Run before final QA to ensure no overlapping modifications.",
        args: {},
        async execute(_, ctx) {
          const session = getSession(ctx.sessionID);
          try {
            const diff = await $`git diff --name-only`.text();
            const files = diff.trim().split("\n").filter(Boolean);

            // Check if any file falls outside all worker scopes
            const warnings: string[] = [];
            const fileWorkerMap = new Map<string, string[]>();

            for (const file of files) {
              const matchingWorkers: string[] = [];
              for (const [id, w] of session.workers) {
                for (const scope of w.spec.fileScope) {
                  const base = scope.replace("/**", "").replace("/*", "");
                  if (file.startsWith(base) || file.startsWith(`./${base}`)) {
                    matchingWorkers.push(`${id}(${w.spec.name})`);
                  }
                }
              }
              if (matchingWorkers.length > 1) {
                warnings.push(`⚠️ **CONFLICT**: \`${file}\` modified by ${matchingWorkers.join(", ")}`);
              }
              fileWorkerMap.set(file, matchingWorkers);
            }

            let output = `## 🔍 Conflict Check\n\nFiles changed: ${files.length}\n\n`;
            if (warnings.length > 0) {
              output += `### ⚠️ Conflicts Found\n${warnings.join("\n")}\n\nResolve before proceeding.`;
            } else {
              output += "✅ No file conflicts between Workers.";
            }
            return output;
          } catch {
            return "No changes to check.";
          }
        },
      }),
    },

    // ═════════════════════════════════════════════════════
    //  LIFECYCLE HOOKS
    // ═════════════════════════════════════════════════════

    event: async ({ event }) => {
      const sid = (event as any).session_id || (event as any).sessionID;
      if (event.type === "session.created" && sid) getSession(sid);
      if (event.type === "session.deleted" && sid) sessions.delete(sid);
    },

    "chat.message": async (input, output) => {
      const session = getSession(input.sessionID);

      const phaseInstructions: Record<CommanderPhase, string> = {
        design: `[AEGIS COMMANDER — DESIGN PHASE]
You MUST design the project with the user before any development.
1. Understand the full project scope
2. Break features into independent, parallelizable units
3. Define non-overlapping file scopes for each Worker
4. Agree on QA strategy
5. Present the plan and call \`design_approve\` when confirmed.
If user says "skip design" / "바로 진행", approve with minimal summary.`,

        foundation: `[AEGIS COMMANDER — FOUNDATION PHASE]
Build shared modules (auth, db, types, utils) BEFORE dispatching Workers.
Workers need a stable foundation to avoid conflicts.
When ready, use \`dispatch_workers\` to launch parallel feature development.`,

        dispatch: `[AEGIS COMMANDER — DISPATCH PHASE]
Use \`dispatch_workers\` with non-overlapping file scopes.
Each Worker spec needs: name, feature, fileScope, sharedReadOnly, spec, qaRequirements.`,

        monitoring: `[AEGIS COMMANDER — MONITORING PHASE]
Workers are running in parallel. Use:
- \`worker_status\` — dashboard of all Workers
- \`worker_output(worker_id)\` — collect individual results
- \`worker_retry(worker_id, instructions)\` — send back for fixes
When all Workers complete, move to integration.`,

        integrate: `[AEGIS COMMANDER — INTEGRATION PHASE]
All Workers completed. Now:
1. \`check_conflicts\` — verify no file overlaps
2. Review each Worker's output
3. Resolve any integration issues
4. Run \`qa_run\` for final project-wide QA`,

        "final-qa": `[AEGIS COMMANDER — FINAL QA]
Run \`qa_run\` for the complete project.
If tests fail, use \`worker_retry\` to send the responsible Worker back.
All checks must pass before committing.`,

        done: "",
      };

      const instruction = phaseInstructions[session.phase];
      if (instruction) {
        output.system = `${output.system || ""}\n\n${instruction}`;
      }

      // Auto-transition to integrate when all workers complete
      if (session.phase === "monitoring") {
        const allDone = [...session.workers.values()].every(
          (w) => w.status === "completed" || w.status === "failed"
        );
        if (allDone && session.workers.size > 0) {
          session.phase = "integrate";
          output.system += `\n\n🎉 All Workers finished! Transition to INTEGRATION phase.
Check conflicts and collect results.`;
        }
      }
    },

    "tool.execute.after": async (input) => {
      const session = getSession(input.sessionID);
      if (input.tool === "edit" || input.tool === "write") {
        const p = (input.args?.filePath as string) || "";
        if (p && !session.filesModified.includes(p)) session.filesModified.push(p);
      }
    },

    stop: async (input) => {
      const session = getSession((input as any).sessionID);
      // Block if workers dispatched but not all complete
      const hasWorkers = session.workers.size > 0;
      const allComplete = [...session.workers.values()].every((w) => w.status === "completed");
      if (hasWorkers && !allComplete) {
        const pending = [...session.workers.values()].filter((w) => w.status !== "completed");
        return {
          response: `\n\n🛡️ [AEGIS] ${pending.length}개 Worker가 아직 완료되지 않았습니다.\n${workerStatusTable(session.workers)}`,
        };
      }
      // Block if QA not run
      if (hasWorkers && allComplete && !Object.keys(session.qaResults).length) {
        return { response: `\n\n🛡️ [AEGIS] 모든 Worker 완료. \`check_conflicts\` → \`qa_run\` 실행하세요.` };
      }
      if (Object.values(session.qaResults).includes("fail")) {
        return { response: `\n\n🛡️ [AEGIS] QA 실패. 해당 Worker에게 \`worker_retry\`로 수정 지시.` };
      }
    },

    "experimental.session.compacting": async (input, output) => {
      const session = getSession((input as any).sessionID || "");
      const workerSummaries = [...session.workers.values()]
        .map((w) => `- ${w.id}(${w.spec.name}): ${w.status}${w.result ? ` — ${w.result.substring(0, 150)}` : ""}`)
        .join("\n");

      output.prompt = `You are Aegis Commander, resuming a session.

Phase: ${session.phase}
Design: ${session.designApproved ? "approved" : "pending"}
Design Summary: ${session.designSummary || "N/A"}
QA Strategy: ${JSON.stringify(session.qaStrategy)}
QA Results: ${JSON.stringify(session.qaResults)}

## Workers (${session.workers.size})
${workerSummaries || "none"}

Resume from current phase. Follow Commander protocol.`;
    },
  };
};

export default AegisPlugin;
