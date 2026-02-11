import { z } from "zod";
export const VllmConfigSchema = z.object({
    baseURL: z.string().default("http://localhost:8001/v1"),
    apiKey: z.string().default("EMPTY"),
    modelId: z.string().default("qwen3-coder-next"),
    modelName: z.string().default("Qwen3-Coder-Next 80B FP8"),
    contextWindow: z.number().default(131072),
    maxTokens: z.number().default(16384),
});
export const SwarmConfigSchema = z.object({
    maxWorkers: z.number().min(1).max(16).default(8),
});
export const PluginConfigSchema = z.object({
    vllm: VllmConfigSchema.default({
        baseURL: "http://localhost:8001/v1",
        apiKey: "EMPTY",
        modelId: "qwen3-coder-next",
        modelName: "Qwen3-Coder-Next 80B FP8",
        contextWindow: 131072,
        maxTokens: 16384,
    }),
    swarm: SwarmConfigSchema.default({
        maxWorkers: 8,
    }),
    disabled_tools: z.array(z.string()).default([]),
    disabled_hooks: z.array(z.string()).default([]),
});
//# sourceMappingURL=schema.js.map