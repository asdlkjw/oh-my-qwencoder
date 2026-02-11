import { createCommanderAgent, createWorkerAgent, createScoutAgent, createLibrarianAgent, } from "../agents/index.js";
export function createConfigHook(pluginConfig) {
    return async (config) => {
        const { vllm } = pluginConfig;
        const fullModelId = `qwen-local/${vllm.modelId}`;
        // Inject provider
        if (!config.provider)
            config.provider = {};
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
        if (!config.model)
            config.model = fullModelId;
        // Inject agents (cast needed: SDK AgentConfig has index signature, our interface doesn't)
        if (!config.agent)
            config.agent = {};
        config.agent.commander = createCommanderAgent(fullModelId);
        config.agent.worker = createWorkerAgent(fullModelId);
        config.agent.scout = createScoutAgent(fullModelId);
        config.agent.librarian = createLibrarianAgent(fullModelId);
        // Inject MCP servers (cast needed: SDK uses "local"/"remote" but runtime accepts "stdio")
        if (!config.mcp)
            config.mcp = {};
        if (!config.mcp.filesystem) {
            config.mcp.filesystem = {
                type: "stdio",
                command: "npx",
                args: ["-y", "@anthropic-ai/filesystem-mcp", "."],
            };
        }
        if (!config.mcp.context7) {
            config.mcp.context7 = {
                type: "stdio",
                command: "npx",
                args: ["-y", "@context7/mcp"],
            };
        }
        if (!config.mcp["grep-app"]) {
            config.mcp["grep-app"] = {
                type: "stdio",
                command: "npx",
                args: ["-y", "@anthropic-ai/grep-app-mcp"],
            };
        }
    };
}
//# sourceMappingURL=provider.js.map