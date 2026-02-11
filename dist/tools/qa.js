import { tool } from "@opencode-ai/plugin";
import { getSession } from "./session.js";
export function createQATools($) {
    return {
        qa_run: tool({
            description: "Run full project QA. Commander uses this for final integration QA after all Workers complete.",
            args: {
                test_cmd: tool.schema.string().optional(),
                lint_cmd: tool.schema.string().optional(),
                typecheck_cmd: tool.schema.string().optional(),
            },
            async execute({ test_cmd, lint_cmd, typecheck_cmd }, ctx) {
                const session = getSession(ctx.sessionID);
                const rows = ["## 🧪 Final QA Report\n", "| Check | Status | Command |", "|-------|--------|---------|"];
                let tc = test_cmd, lc = lint_cmd, cc = typecheck_cmd;
                if (!tc || !lc || !cc) {
                    try {
                        const s = JSON.parse(await $ `cat package.json`.text()).scripts || {};
                        if (!tc)
                            tc = s.test ? "npm test" : undefined;
                        if (!lc)
                            lc = s.lint ? "npm run lint" : undefined;
                        if (!cc)
                            cc = s.typecheck ? "npm run typecheck" : undefined;
                    }
                    catch { }
                    if (!tc) {
                        try {
                            await $ `test -f Cargo.toml`.text();
                            tc = "cargo test";
                            cc = cc || "cargo check";
                            lc = lc || "cargo clippy";
                        }
                        catch { }
                    }
                    if (!cc) {
                        try {
                            await $ `test -f tsconfig.json`.text();
                            cc = "npx tsc --noEmit";
                        }
                        catch { }
                    }
                }
                for (const [name, cmd, key] of [["Type Check", cc, "typecheck"], ["Lint", lc, "lint"], ["Tests", tc, "test"]]) {
                    if (!cmd)
                        continue;
                    try {
                        await $ `sh -c '${cmd} 2>&1'`.text();
                        session.qaResults[key] = "pass";
                        rows.push(`| ${name} | ✅ | \`${cmd}\` |`);
                    }
                    catch (e) {
                        session.qaResults[key] = "fail";
                        rows.push(`| ${name} | ❌ | \`${cmd}\` |`);
                        rows.push(`\n\`\`\`\n${String(e?.stdout || e).substring(0, 400)}\n\`\`\`\n`);
                    }
                }
                try {
                    rows.push(`\n### Changes\n\`\`\`\n${await $ `git diff --stat`.text()}\n\`\`\``);
                }
                catch { }
                const hasFail = Object.values(session.qaResults).includes("fail");
                rows.push(hasFail ? "\n⚠️ **QA 실패.** 해당 Worker에게 `worker_retry`로 수정 지시." : "\n✅ **전체 QA 통과.** 커밋 준비 완료.");
                if (!hasFail)
                    session.phase = "done";
                return rows.join("\n");
            },
        }),
        check_conflicts: tool({
            description: "Check for file conflicts between Workers. Run before final QA to ensure no overlapping modifications.",
            args: {},
            async execute(_, ctx) {
                const session = getSession(ctx.sessionID);
                try {
                    const diff = await $ `git diff --name-only`.text();
                    const files = diff.trim().split("\n").filter(Boolean);
                    const warnings = [];
                    const fileWorkerMap = new Map();
                    for (const file of files) {
                        const matchingWorkers = [];
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
                    }
                    else {
                        output += "✅ No file conflicts between Workers.";
                    }
                    return output;
                }
                catch {
                    return "No changes to check.";
                }
            },
        }),
    };
}
//# sourceMappingURL=qa.js.map