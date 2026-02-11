// Session types and state management for Aegis swarm
const sessions = new Map();
export function getSession(sid) {
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
export function deleteSession(sid) {
    sessions.delete(sid);
}
export function genWorkerId(s) {
    s.workerCounter++;
    return `w${String(s.workerCounter).padStart(2, "0")}`;
}
export function genBgId(s) {
    s.bgCounter++;
    return `bg_${String(s.bgCounter).padStart(2, "0")}`;
}
export function workerStatusTable(workers) {
    if (workers.size === 0)
        return "No workers dispatched.";
    const rows = ["| ID | Feature | Status | Duration | Retries |", "|---|---|---|---|---|"];
    const emojis = {
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
//# sourceMappingURL=session.js.map