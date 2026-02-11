// Session types and state management for Aegis swarm

export type CommanderPhase =
  | "design"
  | "foundation"
  | "dispatch"
  | "monitoring"
  | "integrate"
  | "final-qa"
  | "done";

export interface QAStrategy {
  workerSelfQA: boolean;
  unitTest: boolean;
  integrationTest: boolean;
  e2eTest: boolean;
  typeCheck: boolean;
  lint: boolean;
}

export interface WorkerSpec {
  name: string;
  feature: string;
  fileScope: string[];
  sharedReadOnly: string[];
  spec: string;
  qaRequirements: string;
}

export interface WorkerInstance {
  id: string;
  spec: WorkerSpec;
  status: "pending" | "exploring" | "implementing" | "self-qa" | "completed" | "failed" | "retry";
  result: string;
  startedAt: number;
  completedAt?: number;
  retryCount: number;
  sessionId?: string;
}

export interface BackgroundTask {
  id: string;
  agent: string;
  prompt: string;
  status: "pending" | "running" | "completed" | "failed";
  result: string;
  startedAt: number;
  completedAt?: number;
}

export interface AegisSession {
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

export function getSession(sid: string): AegisSession {
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

export function deleteSession(sid: string): void {
  sessions.delete(sid);
}

export function genWorkerId(s: AegisSession): string {
  s.workerCounter++;
  return `w${String(s.workerCounter).padStart(2, "0")}`;
}

export function genBgId(s: AegisSession): string {
  s.bgCounter++;
  return `bg_${String(s.bgCounter).padStart(2, "0")}`;
}

export function workerStatusTable(workers: Map<string, WorkerInstance>): string {
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
