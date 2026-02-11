import { getSession } from "../tools/session.js";
export async function sessionCompactingHook(input, output) {
    const session = getSession(input.sessionID || "");
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
}
//# sourceMappingURL=session-compacting.js.map