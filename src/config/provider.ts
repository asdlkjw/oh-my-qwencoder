import type { Config } from "@opencode-ai/sdk";
import type { PluginConfig } from "./schema.js";
import {
  createCommanderAgent,
  createWorkerAgent,
  createScoutAgent,
  createLibrarianAgent,
} from "../agents/index.js";

export function createConfigHook(pluginConfig: PluginConfig) {
  return async (config: Config): Promise<void> => {
    const { vllm } = pluginConfig;

    // Skip provider injection if vLLM is not enabled (prevents black screen)
    if (!vllm.enabled) return;

    const fullModelId = `qwen-local/${vllm.modelId}`;

    // Inject provider
    if (!config.provider) config.provider = {};
    config.provider["qwen-local"] = {
      npm: "@ai-sdk/openai-compatible",
      name: vllm.modelName,
      options: {
        baseURL: vllm.baseURL,
        apiKey: vllm.apiKey,
      },
      models: {
        [vllm.modelId]: {
          name: vllm.modelName,
          tool_call: true,
          limit: {
            context: vllm.contextWindow,
            output: vllm.maxTokens,
          },
        },
      },
    };

    // Set default model
    if (!config.model) config.model = fullModelId;

    // Inject agents (cast needed: SDK AgentConfig has index signature, our interface doesn't)
    if (!config.agent) config.agent = {};

    // Remove default OpenCode agents (user only wants Aegis)
    delete config.agent.build;
    delete config.agent.plan;

    // Register Aegis agents (capital A — UI displays "Aegis")
    config.agent.Aegis = createCommanderAgent(fullModelId) as any;
    config.agent.worker = createWorkerAgent(fullModelId) as any;
    config.agent.scout = createScoutAgent(fullModelId) as any;
    config.agent.librarian = createLibrarianAgent(fullModelId) as any;

    // Set Aegis as the default agent
    (config as any).default_agent = "Aegis";

    // Inject MCP servers (cast needed: SDK uses "local"/"remote" but runtime accepts "stdio")
    if (!config.mcp) config.mcp = {};
    if (!config.mcp.filesystem) {
      (config.mcp as any).filesystem = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@anthropic-ai/filesystem-mcp", "."],
      };
    }
    if (!config.mcp.context7) {
      (config.mcp as any).context7 = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@context7/mcp"],
      };
    }
    if (!config.mcp["grep-app"]) {
      (config.mcp as any)["grep-app"] = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@anthropic-ai/grep-app-mcp"],
      };
    }
  };
}
