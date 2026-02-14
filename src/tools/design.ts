import { tool } from "@opencode-ai/plugin";
import { getSession, type QAStrategy } from "./session.js";

export const designTools = {
  design_ask: tool({
    description:
      "Present a structured interview question with options during DESIGN phase. User can select by number or provide custom input.",
    args: {
      topic: tool.schema
        .string()
        .describe(
          "Question topic identifier (e.g. 'project_type', 'tech_stack', 'architecture')",
        ),
      question: tool.schema
        .string()
        .describe("The question to ask the user (in Korean)"),
      options: tool.schema
        .array(tool.schema.string())
        .describe(
          "List of 5-10 option strings. Each should be concise but descriptive.",
        ),
    },
    async execute({ topic, question, options }, ctx) {
      const session = getSession(ctx.sessionID);

      if (session.phase !== "design") {
        return "\u26a0\ufe0f design_ask is only available during DESIGN phase.";
      }
      if (options.length < 2) {
        return "\u26a0\ufe0f Provide at least 2 options.";
      }

      const formatted = [
        `## \ud83c\udfaf ${question}`,
        "",
        ...options.map((opt, i) => `  ${i + 1}. ${opt}`),
        "",
        `\ud83d\udcac \ubc88\ud638\ub97c \uc120\ud0dd\ud558\uac70\ub098, \uc6d0\ud558\ub294 \ub0b4\uc6a9\uc744 \uc9c1\uc811 \uc785\ub825\ud574\uc8fc\uc138\uc694.`,
      ].join("\n");

      session.interviewHistory.push({
        topic,
        question,
        options,
        answer: "",
      });

      return formatted;
    },
  }),

  design_answer: tool({
    description:
      "Record user's answer to the most recent design_ask question. Call this after the user responds.",
    args: {
      answer: tool.schema
        .string()
        .describe(
          "User's answer — either the option number or their custom text",
        ),
    },
    async execute({ answer }, ctx) {
      const session = getSession(ctx.sessionID);
      const history = session.interviewHistory;

      if (history.length === 0) {
        return "\u26a0\ufe0f No pending question. Use design_ask first.";
      }

      const lastEntry = history[history.length - 1];
      if (lastEntry.answer !== "") {
        return "\u26a0\ufe0f Last question already answered. Ask a new question with design_ask.";
      }

      const num = parseInt(answer.trim(), 10);
      if (!isNaN(num) && num >= 1 && num <= lastEntry.options.length) {
        lastEntry.answer = lastEntry.options[num - 1];
      } else {
        lastEntry.answer = answer.trim();
      }

      const answered = history.filter((e) => e.answer !== "").length;
      const total = history.length;

      return [
        `\u2705 \ub2f5\ubcc0 \uae30\ub85d: "${lastEntry.answer}"`,
        "",
        `\ud83d\udcca \uc778\ud130\ubdf0 \uc9c4\ud589: ${answered}/${total} \uc9c8\ubb38 \uc644\ub8cc`,
        "",
        `\ub2e4\uc74c \uc9c8\ubb38\uc774 \uc788\uc73c\uba74 design_ask\ub97c, \uc778\ud130\ubdf0\uac00 \ub05d\ub0ac\uc73c\uba74 \uc124\uacc4\ub97c \uc815\ub9ac\ud558\uace0 design_approve\ub97c \ud638\ucd9c\ud558\uc138\uc694.`,
      ].join("\n");
    },
  }),

  design_approve: tool({
    description:
      "Approve the project design. Transitions to FOUNDATION phase.",
    args: {
      summary: tool.schema
        .string()
        .describe("Full design summary (markdown)"),
      qa_strategy: tool.schema
        .enum([
          "worker-self-qa",
          "commander-all",
          "worker-unit-commander-integration",
          "full-e2e",
        ])
        .describe("QA distribution strategy"),
    },
    async execute({ summary, qa_strategy }, ctx) {
      const session = getSession(ctx.sessionID);
      session.designApproved = true;

      const interviewSummary = session.interviewHistory
        .filter((e) => e.answer !== "")
        .map((e) => `**${e.topic}**: ${e.answer}`)
        .join("\n");

      const fullSummary = interviewSummary
        ? `${summary}\n\n### \ud83d\udccb \uc778\ud130\ubdf0 \uacb0\uacfc\n${interviewSummary}`
        : summary;

      session.designSummary = fullSummary;
      session.phase = "foundation";

      const strategies: Record<string, QAStrategy> = {
        "worker-self-qa": {
          workerSelfQA: true,
          unitTest: true,
          integrationTest: false,
          e2eTest: false,
          typeCheck: true,
          lint: true,
        },
        "commander-all": {
          workerSelfQA: false,
          unitTest: true,
          integrationTest: true,
          e2eTest: false,
          typeCheck: true,
          lint: true,
        },
        "worker-unit-commander-integration": {
          workerSelfQA: true,
          unitTest: true,
          integrationTest: true,
          e2eTest: false,
          typeCheck: true,
          lint: true,
        },
        "full-e2e": {
          workerSelfQA: true,
          unitTest: true,
          integrationTest: true,
          e2eTest: true,
          typeCheck: true,
          lint: true,
        },
      };
      session.qaStrategy = strategies[qa_strategy];

      return `\u2705 Design approved. QA: ${qa_strategy}\n\nNow build the FOUNDATION (shared modules, types, project structure) before dispatching Workers.\nUse \`dispatch_workers\` when the foundation is ready.`;
    },
  }),
};
