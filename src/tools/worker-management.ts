import { tool } from "@opencode-ai/plugin";
import {
  getSession, genWorkerId,
  workerStatusTable,
  type WorkerSpec, type WorkerInstance,
} from "./session.js";

type PluginClient = any;

export function createWorkerTools(client: PluginClient) {
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

  return {
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
          launchWorker(ctx.sessionID, id);
        }

        return `🚀 ${specs.length} Workers dispatched!\n\n${launched.join("\n")}\n\nAll running in parallel via vLLM concurrent inference.\nUse \`worker_status\` to monitor progress.\nUse \`worker_output\` to collect individual results.`;
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
          const timeout = 300_000;
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

        const retrySpec = { ...worker.spec };
        retrySpec.spec += `\n\n## 🔄 Retry Instructions (from Commander)\n${instructions}`;
        worker.spec = retrySpec;

        launchWorker(ctx.sessionID, worker_id);

        return `🔄 Worker ${worker_id} (${worker.spec.name}) retrying. Attempt #${worker.retryCount + 1}\nInstructions: ${instructions}`;
      },
    }),
  };
}
