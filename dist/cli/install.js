import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const CONFIG_FILENAME = "oh-my-qwencoder.json";
const BANNER = `
\x1b[36m╔══════════════════════════════════════════╗
║  🛡️  Aegis v3                             ║
║  Parallel Development Swarm for OpenCode  ║
╚══════════════════════════════════════════╝\x1b[0m
`;
async function askWithDefault(rl, question, defaultValue) {
    const answer = await rl.question(`  ${question} (${defaultValue}): `);
    return answer.trim() || defaultValue;
}
async function testConnection(baseURL, apiKey) {
    try {
        stdout.write(`\n  🔍 Testing connection to ${baseURL}...\n`);
        const headers = { "Content-Type": "application/json" };
        if (apiKey && apiKey !== "EMPTY") {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }
        const res = await fetch(`${baseURL}/models`, { headers, signal: AbortSignal.timeout(10000) });
        if (!res.ok) {
            return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
        }
        const data = (await res.json());
        const modelId = data?.data?.[0]?.id || "unknown";
        return { ok: true, model: modelId };
    }
    catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}
function getGlobalConfigDir() {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return join(home, ".config", "opencode");
}
function ensureDir(dir) {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
function writeGlobalConfig(answers) {
    const configDir = getGlobalConfigDir();
    ensureDir(configDir);
    const config = {
        vllm: {
            enabled: answers.enabled,
            baseURL: answers.baseURL,
            apiKey: answers.apiKey,
            modelId: answers.modelId,
            modelName: answers.modelName,
            contextWindow: answers.contextWindow,
            maxTokens: answers.maxTokens,
        },
        swarm: { maxWorkers: 8 },
        disabled_tools: [],
        disabled_hooks: [],
    };
    const configPath = join(configDir, CONFIG_FILENAME);
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    return configPath;
}
function registerPlugin() {
    const configDir = getGlobalConfigDir();
    ensureDir(configDir);
    const opencodePath = join(configDir, "opencode.json");
    let opencodeConfig = {};
    if (existsSync(opencodePath)) {
        try {
            opencodeConfig = JSON.parse(readFileSync(opencodePath, "utf-8"));
        }
        catch { }
    }
    if (!opencodeConfig.plugin)
        opencodeConfig.plugin = [];
    const pluginName = "oh-my-qwencoder";
    if (!opencodeConfig.plugin.includes(pluginName)) {
        opencodeConfig.plugin.push(pluginName);
    }
    writeFileSync(opencodePath, JSON.stringify(opencodeConfig, null, 2) + "\n");
    return opencodePath;
}
export async function runInstall(_args) {
    console.log(BANNER);
    const rl = createInterface({ input: stdin, output: stdout });
    try {
        // Ask about server availability
        const hasServer = await rl.question("Do you have a vLLM or llama.cpp compatible server? (y/N): ");
        const wantsServer = hasServer.trim().toLowerCase() === "y" || hasServer.trim().toLowerCase() === "yes";
        let answers;
        if (wantsServer) {
            console.log("");
            const baseURL = await askWithDefault(rl, "Server base URL", "http://localhost:8001/v1");
            const apiKey = await askWithDefault(rl, "API key", "EMPTY");
            const modelId = await askWithDefault(rl, "Model ID", "qwen3-coder-next");
            const modelName = await askWithDefault(rl, "Model display name", "Qwen3-Coder-Next 80B FP8");
            const ctxStr = await askWithDefault(rl, "Context window", "131072");
            const maxStr = await askWithDefault(rl, "Max output tokens", "16384");
            // Test connection
            const result = await testConnection(baseURL, apiKey);
            if (result.ok) {
                console.log(`  \x1b[32m✅ Connected! Model: ${result.model}\x1b[0m`);
            }
            else {
                console.log(`  \x1b[33m⚠️  Connection failed: ${result.error}\x1b[0m`);
                console.log(`  \x1b[33m   Config will be saved anyway. Fix the server and retry.\x1b[0m`);
            }
            answers = {
                enabled: result.ok,
                baseURL,
                apiKey,
                modelId,
                modelName,
                contextWindow: parseInt(ctxStr, 10) || 131072,
                maxTokens: parseInt(maxStr, 10) || 16384,
            };
        }
        else {
            console.log("\n  \x1b[33m⚠️  No server configured. Aegis agents will be disabled.\x1b[0m");
            console.log("  \x1b[33m   Run 'oh-my-qwencoder install' again after setting up your server.\x1b[0m");
            answers = {
                enabled: false,
                baseURL: "http://localhost:8001/v1",
                apiKey: "EMPTY",
                modelId: "qwen3-coder-next",
                modelName: "Qwen3-Coder-Next 80B FP8",
                contextWindow: 131072,
                maxTokens: 16384,
            };
        }
        // Write global config
        const configPath = writeGlobalConfig(answers);
        console.log(`\n  \x1b[32m✅ Config saved → ${configPath}\x1b[0m`);
        // Update project-level config if it exists
        const cwd = process.cwd();
        const projectConfigDir = join(cwd, ".opencode");
        const projectConfigPath = join(projectConfigDir, CONFIG_FILENAME);
        if (existsSync(projectConfigPath)) {
            const projectConfig = {
                vllm: {
                    enabled: answers.enabled,
                    baseURL: answers.baseURL,
                    apiKey: answers.apiKey,
                    modelId: answers.modelId,
                    modelName: answers.modelName,
                    contextWindow: answers.contextWindow,
                    maxTokens: answers.maxTokens,
                },
                swarm: { maxWorkers: 8 },
                disabled_tools: [],
                disabled_hooks: [],
            };
            writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2) + "\n");
            console.log(`  \x1b[32m✅ Project config updated → ${projectConfigPath}\x1b[0m`);
        }
        // Register plugin in global opencode.json
        const opencodePath = registerPlugin();
        console.log(`  \x1b[32m✅ Plugin registered → ${opencodePath}\x1b[0m`);
        // Also register in project-level if we're in a project with opencode.json
        const projectOpencode = join(cwd, "opencode.json");
        if (existsSync(projectOpencode)) {
            try {
                const projConfig = JSON.parse(readFileSync(projectOpencode, "utf-8"));
                if (!projConfig.plugin)
                    projConfig.plugin = [];
                if (!projConfig.plugin.includes("oh-my-qwencoder")) {
                    projConfig.plugin.push("oh-my-qwencoder");
                    writeFileSync(projectOpencode, JSON.stringify(projConfig, null, 2) + "\n");
                    console.log(`  \x1b[32m✅ Plugin registered → ${projectOpencode} (project)\x1b[0m`);
                }
            }
            catch { }
        }
        // Summary
        const status = answers.enabled ? "\x1b[32menabled\x1b[0m" : "\x1b[33mdisabled\x1b[0m";
        console.log(`
\x1b[36m─────────────────────────────────────\x1b[0m
  Status: ${status}
  Server: ${answers.baseURL}
  Model:  ${answers.modelId}
\x1b[36m─────────────────────────────────────\x1b[0m

Next steps:
  ${answers.enabled ? "opencode              ← Start coding!" : "1. Start your vLLM/llama.cpp server"}
  ${answers.enabled ? "oh-my-qwencoder doctor ← Health check" : "2. oh-my-qwencoder install  ← Re-run setup"}
  ${answers.enabled ? "" : "3. opencode                 ← Start coding!"}
`);
    }
    finally {
        rl.close();
    }
}
//# sourceMappingURL=install.js.map