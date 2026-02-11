import type { Plugin } from "@opencode-ai/plugin";
import { loadPluginConfig } from "./config/loader.js";
import { createConfigHook } from "./config/provider.js";
import { designTools } from "./tools/design.js";
import { createWorkerTools } from "./tools/worker-management.js";
import { createBackgroundTools } from "./tools/background.js";
import { createCodeIntelTools } from "./tools/code-intelligence.js";
import { createGitTools } from "./tools/git.js";
import { createQATools } from "./tools/qa.js";
import { chatMessageHook } from "./hooks/chat-message.js";
import { toolExecuteAfterHook } from "./hooks/tool-execute-after.js";
import { stopHook } from "./hooks/stop.js";
import { sessionCompactingHook } from "./hooks/session-compacting.js";
import { eventHook } from "./hooks/event.js";

const OhMyQwencoderPlugin: Plugin = async ({ client, directory, $ }) => {
  const pluginConfig = loadPluginConfig(directory);

  await client.app.log({
    body: { service: "aegis", level: "info", message: `\uD83D\uDEE1\uFE0F Aegis v3 Swarm loaded \u2014 ${directory}` },
  });

  const workerTools = createWorkerTools(client);
  const backgroundTools = createBackgroundTools(client);
  const codeIntelTools = createCodeIntelTools($);
  const gitTools = createGitTools($);
  const qaTools = createQATools($);

  const allTools: Record<string, any> = {
    ...designTools,
    ...workerTools,
    ...backgroundTools,
    ...codeIntelTools,
    ...gitTools,
    ...qaTools,
  };

  for (const name of pluginConfig.disabled_tools) {
    delete allTools[name];
  }

  return {
    config: createConfigHook(pluginConfig),
    tool: allTools,
    "chat.message": pluginConfig.disabled_hooks.includes("chat.message") ? undefined : chatMessageHook as any,
    "tool.execute.after": pluginConfig.disabled_hooks.includes("tool.execute.after") ? undefined : toolExecuteAfterHook as any,
    stop: pluginConfig.disabled_hooks.includes("stop") ? undefined : stopHook as any,
    event: pluginConfig.disabled_hooks.includes("event") ? undefined : eventHook,
    "experimental.session.compacting": pluginConfig.disabled_hooks.includes("session.compacting") ? undefined : sessionCompactingHook as any,
  } as any;
};

export default OhMyQwencoderPlugin;
