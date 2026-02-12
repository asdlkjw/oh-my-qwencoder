import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function getGlobalConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return join(home, ".config", "opencode");
}

function loadConfig(path: string): Record<string, any> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export async function runDoctor(_args: string[]): Promise<void> {
  const cwd = process.cwd();
  const globalDir = getGlobalConfigDir();
  console.log("\n🛡️  oh-my-qwencoder doctor\n");

  let warnings = 0;
  let errors = 0;

  // 1. Check opencode.json (global then project)
  const globalOpencodePath = join(globalDir, "opencode.json");
  const projectOpencodePath = join(cwd, "opencode.json");

  let pluginRegistered = false;

  const globalOpencodeConfig = loadConfig(globalOpencodePath);
  if (globalOpencodeConfig) {
    if (globalOpencodeConfig.plugin?.includes("oh-my-qwencoder")) {
      console.log(`  ✅ Plugin registered (global) → ${globalOpencodePath}`);
      pluginRegistered = true;
    }
  }

  const projectOpencodeConfig = loadConfig(projectOpencodePath);
  if (projectOpencodeConfig) {
    if (projectOpencodeConfig.plugin?.includes("oh-my-qwencoder")) {
      console.log(`  ✅ Plugin registered (project) → ${projectOpencodePath}`);
      pluginRegistered = true;
    }
  }

  if (!pluginRegistered) {
    console.log("  ❌ oh-my-qwencoder not registered in any opencode.json");
    console.log("     Run: oh-my-qwencoder install");
    errors++;
  }

  // 2. Check oh-my-qwencoder.json configs
  const globalConfigPath = join(globalDir, "oh-my-qwencoder.json");
  const projectConfigPath = join(cwd, ".opencode", "oh-my-qwencoder.json");

  const globalPluginConfig = loadConfig(globalConfigPath);
  const projectPluginConfig = loadConfig(projectConfigPath);

  // Show individual configs
  if (globalPluginConfig) {
    const enabled = globalPluginConfig.vllm?.enabled;
    const baseURL = globalPluginConfig.vllm?.baseURL || "not set";
    console.log(`  ✅ Global config → ${globalConfigPath}`);
    console.log(`     enabled: ${enabled !== undefined ? (enabled ? "yes" : "no") : "not set"}, endpoint: ${baseURL}`);
  } else {
    console.log(`  ⚠️  No global config → ${globalConfigPath}`);
    warnings++;
  }

  if (projectPluginConfig) {
    const enabled = projectPluginConfig.vllm?.enabled;
    const baseURL = projectPluginConfig.vllm?.baseURL || "not set";
    console.log(`  ✅ Project config → ${projectConfigPath}`);
    console.log(`     enabled: ${enabled !== undefined ? (enabled ? "yes" : "no") : "not set"}, endpoint: ${baseURL}`);

    // Bug 4: Warn about stale project config
    if (projectPluginConfig.vllm && !("enabled" in projectPluginConfig.vllm)) {
      console.log("  ⚠️  Project config is outdated (missing 'enabled' field)");
      console.log("     Run 'oh-my-qwencoder install' to update");
      warnings++;
    }
  }

  if (!globalPluginConfig && !projectPluginConfig) {
    console.log("  ❌ oh-my-qwencoder.json not found (global or project)");
    console.log("     Run: oh-my-qwencoder install");
    errors++;
  }

  // Compute effective (merged) config — same logic as loader.ts
  let effectiveMerged: Record<string, any> = {};
  for (const raw of [globalPluginConfig, projectPluginConfig]) {
    if (!raw) continue;
    for (const [key, value] of Object.entries(raw)) {
      if (
        typeof value === "object" && value !== null && !Array.isArray(value) &&
        typeof effectiveMerged[key] === "object" && effectiveMerged[key] !== null && !Array.isArray(effectiveMerged[key])
      ) {
        effectiveMerged[key] = { ...effectiveMerged[key], ...value };
      } else {
        effectiveMerged[key] = value;
      }
    }
  }

  const pluginConfig = (globalPluginConfig || projectPluginConfig) ? effectiveMerged : null;

  if (pluginConfig && (globalPluginConfig && projectPluginConfig)) {
    const enabled = pluginConfig.vllm?.enabled;
    const baseURL = pluginConfig.vllm?.baseURL || "not set";
    console.log(`  📋 Effective config (merged)`);
    console.log(`     enabled: ${enabled ? "yes" : "no"}, endpoint: ${baseURL}`);
  }

  // 3. Check vLLM connectivity (only if enabled)
  if (pluginConfig?.vllm?.enabled) {
    const vllmUrl = pluginConfig.vllm.baseURL || "http://localhost:8001/v1";
    const apiKey = pluginConfig.vllm.apiKey;

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey && apiKey !== "EMPTY") {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      const res = await fetch(`${vllmUrl}/models`, { headers, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json() as any;
        const models = data.data?.map((m: any) => m.id).join(", ") || "unknown";
        console.log(`  ✅ vLLM reachable → ${vllmUrl}`);
        console.log(`     Models: ${models}`);
      } else {
        console.log(`  ⚠️  vLLM responded with HTTP ${res.status} → ${vllmUrl}`);
        warnings++;
      }
    } catch {
      console.log(`  ⚠️  vLLM not reachable → ${vllmUrl}`);
      console.log("     Check your server or run: oh-my-qwencoder install");
      warnings++;
    }
  } else if (pluginConfig && !pluginConfig.vllm?.enabled) {
    console.log("  ℹ️  vLLM disabled — skipping connectivity check");
    console.log("     Run 'oh-my-qwencoder install' to enable");
  }

  // 4. Check opencode CLI
  try {
    const { execSync } = await import("node:child_process");
    execSync("which opencode", { stdio: "pipe" });
    console.log("  ✅ opencode CLI found");
  } catch {
    console.log("  ❌ opencode CLI not found");
    console.log("     Install: curl -fsSL https://opencode.ai/install | bash");
    errors++;
  }

  // Summary
  if (errors > 0) {
    console.log(`\n❌ ${errors} error(s), ${warnings} warning(s)\n`);
  } else if (warnings > 0) {
    console.log(`\n⚠️  ${warnings} warning(s), but no errors\n`);
  } else {
    console.log("\n✅ All checks passed!\n");
  }
}
