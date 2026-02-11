import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PluginConfigSchema } from "./schema.js";
const CONFIG_FILENAME = "oh-my-qwencoder.json";
function findConfigPaths(projectDir) {
    const paths = [];
    // Project-level config: .opencode/oh-my-qwencoder.json
    const projectConfig = join(projectDir, ".opencode", CONFIG_FILENAME);
    if (existsSync(projectConfig))
        paths.push(projectConfig);
    // User-level config: ~/.config/opencode/oh-my-qwencoder.json
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const userConfig = join(home, ".config", "opencode", CONFIG_FILENAME);
    if (existsSync(userConfig))
        paths.push(userConfig);
    return paths;
}
function loadJsonFile(path) {
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    }
    catch {
        return {};
    }
}
export function loadPluginConfig(projectDir) {
    const configPaths = findConfigPaths(projectDir);
    // Merge configs: project overrides user overrides defaults
    let merged = {};
    for (const p of configPaths.reverse()) {
        merged = { ...merged, ...loadJsonFile(p) };
    }
    return PluginConfigSchema.parse(merged);
}
//# sourceMappingURL=loader.js.map