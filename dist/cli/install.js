import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const CONFIG_FILENAME = "oh-my-qwencoder.json";
const DEFAULT_CONFIG = {
    vllm: {
        baseURL: "http://localhost:8001/v1",
        apiKey: "EMPTY",
        modelId: "qwen3-coder-next",
        modelName: "Qwen3-Coder-Next 80B FP8",
        contextWindow: 131072,
        maxTokens: 16384,
    },
    swarm: { maxWorkers: 8 },
    disabled_tools: [],
    disabled_hooks: [],
};
export async function runInstall(args) {
    const cwd = process.cwd();
    console.log("\n🛡️  oh-my-qwencoder installer\n");
    // 1. Ensure .opencode directory exists
    const opencodeDir = join(cwd, ".opencode");
    if (!existsSync(opencodeDir)) {
        mkdirSync(opencodeDir, { recursive: true });
        console.log("  ✅ Created .opencode/");
    }
    // 2. Write oh-my-qwencoder.json config
    const configPath = join(opencodeDir, CONFIG_FILENAME);
    if (existsSync(configPath)) {
        console.log(`  ℹ️  ${CONFIG_FILENAME} already exists, skipping`);
    }
    else {
        writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
        console.log(`  ✅ Created .opencode/${CONFIG_FILENAME}`);
    }
    // 3. Update or create opencode.json
    const opencodePath = join(cwd, "opencode.json");
    let opencodeConfig = {};
    if (existsSync(opencodePath)) {
        try {
            opencodeConfig = JSON.parse(readFileSync(opencodePath, "utf-8"));
        }
        catch { }
    }
    // Add plugin reference
    if (!opencodeConfig.plugin)
        opencodeConfig.plugin = [];
    const pluginName = "oh-my-qwencoder";
    if (!opencodeConfig.plugin.includes(pluginName)) {
        opencodeConfig.plugin.push(pluginName);
        console.log("  ✅ Added oh-my-qwencoder to opencode.json plugins");
    }
    else {
        console.log("  ℹ️  Plugin already registered in opencode.json");
    }
    writeFileSync(opencodePath, JSON.stringify(opencodeConfig, null, 2) + "\n");
    console.log(`
✅ Installation complete!

Next steps:
  1. Start vLLM:  oh-my-qwencoder start-vllm
  2. Check setup: oh-my-qwencoder doctor
  3. Run:         opencode
`);
}
//# sourceMappingURL=install.js.map