import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PluginConfigSchema, type PluginConfig } from "./schema.js";

const CONFIG_FILENAME = "oh-my-qwencoder.json";

export function findConfigPaths(projectDir: string): string[] {
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

export function loadJsonFile(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

export function loadPluginConfig(projectDir: string): PluginConfig {
  const configPaths = findConfigPaths(projectDir);

  // Deep merge: global defaults ← project overrides (field-level for nested objects)
  let merged: Record<string, unknown> = {};
  for (const p of configPaths.reverse()) {
    const raw = loadJsonFile(p);
    for (const [key, value] of Object.entries(raw)) {
      if (
        typeof value === "object" && value !== null && !Array.isArray(value) &&
        typeof merged[key] === "object" && merged[key] !== null && !Array.isArray(merged[key])
      ) {
        merged[key] = { ...(merged[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
      } else {
        merged[key] = value;
      }
    }
  }

  return PluginConfigSchema.parse(merged);
}
