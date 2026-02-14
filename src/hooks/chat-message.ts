import { getSession, type CommanderPhase } from "../tools/session.js";

export async function chatMessageHook(input: any, output: any): Promise<void> {
  const session = getSession(input.sessionID);

  const phaseInstructions: Record<CommanderPhase, string> = {
    design: `[AEGIS COMMANDER — DESIGN PHASE]
You MUST conduct a structured interview using \`design_ask\` before any development.
For each question, generate 5-10 options dynamically based on the project context.
After the user responds, record with \`design_answer\`.

Required topics (in order): project_type → tech_stack → features → architecture → qa_strategy
Optional topics (as needed): database, auth, deployment, ui_framework, api_design

After all topics are covered, summarize the design and call \`design_approve\`.
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
      output.system += `\n\n🎉 All Workers finished! Transition to INTEGRATION phase.\nCheck conflicts and collect results.`;
    }
  }
}
