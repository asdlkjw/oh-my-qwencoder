import { tool } from "@opencode-ai/plugin";
import { getSession, type QAStrategy } from "./session.js";

export const designTools = {
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

      return `✅ Design approved. QA: ${qa_strategy}\n\nNow build the FOUNDATION (shared modules, types, project structure) before dispatching Workers.\nUse \`dispatch_workers\` when the foundation is ready.`;
    },
  }),
};
