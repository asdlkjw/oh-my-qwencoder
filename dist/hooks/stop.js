import { getSession, workerStatusTable } from "../tools/session.js";
export async function stopHook(input) {
    const session = getSession(input.sessionID);
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
    return undefined;
}
//# sourceMappingURL=stop.js.map