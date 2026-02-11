import { tool } from "@opencode-ai/plugin";
import { getSession, genBgId } from "./session.js";

type PluginClient = any;

export function createBackgroundTools(client: PluginClient) {
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
        const emoji: Record<string, string> = { pending: "⏳", running: "🔄", completed: "✅", failed: "❌" };
        let out = `${emoji[task.status] || "?"} ${task_id} (${task.agent}): ${task.status}\n`;
        if (task.result) out += `---\n${task.result}`;
        return out;
      },
    }),
  };
}
