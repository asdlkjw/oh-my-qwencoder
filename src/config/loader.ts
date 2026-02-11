import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PluginConfigSchema, type PluginConfig } from "./schema.js";

const CONFIG_FILENAME = "oh-my-qwencoder.json";

function findConfigPaths(projectDir: string): string[] {
  const paths: string[] = [];

  // Project-level config: .opencode/oh-my-qwencoder.json
  const projectConfig = join(projectDir, ".opencode", CONFIG_FILENAME);
  if (existsSync(projectConfig)) paths.push(projectConfig);

  // User-level config: ~/.config/opencode/oh-my-qwencoder.json
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const userConfig = join(home, ".config", "opencode", CONFIG_FILENAME);
  if (existsSync(userConfig)) paths.push(userConfig);

  return paths;
}

function loadJsonFile(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

export function loadPluginConfig(projectDir: string): PluginConfig {
  const configPaths = findConfigPaths(projectDir);

  // Merge configs: project overrides user overrides defaults
  let merged: Record<string, unknown> = {};
  for (const p of configPaths.reverse()) {
    merged = { ...merged, ...loadJsonFile(p) };
  }

  return PluginConfigSchema.parse(merged);
}
