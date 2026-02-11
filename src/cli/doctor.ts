import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export async function runDoctor(args: string[]): Promise<void> {
  const cwd = process.cwd();
  console.log("\n🛡️  oh-my-qwencoder doctor\n");

  let allOk = true;

  // 1. Check opencode.json exists
  const opencodePath = join(cwd, "opencode.json");
  if (existsSync(opencodePath)) {
    console.log("  ✅ opencode.json found");
    try {
      const config = JSON.parse(readFileSync(opencodePath, "utf-8"));
      if (config.plugin?.includes("oh-my-qwencoder")) {
        console.log("  ✅ oh-my-qwencoder registered as plugin");
      } else {
        console.log("  ❌ oh-my-qwencoder not in plugin list. Run: oh-my-qwencoder install");
        allOk = false;
      }
    } catch {
      console.log("  ❌ opencode.json is invalid JSON");
      allOk = false;
    }
  } else {
    console.log("  ❌ opencode.json not found. Run: oh-my-qwencoder install");
    allOk = false;
  }

  // 2. Check config
  const configPath = join(cwd, ".opencode", "oh-my-qwencoder.json");
  if (existsSync(configPath)) {
    console.log("  ✅ .opencode/oh-my-qwencoder.json found");
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      console.log(`     vLLM endpoint: ${config.vllm?.baseURL || "not set"}`);
    } catch {
      console.log("  ❌ Config file is invalid JSON");
      allOk = false;
    }
  } else {
    console.log("  ❌ .opencode/oh-my-qwencoder.json not found. Run: oh-my-qwencoder install");
    allOk = false;
  }

  // 3. Check vLLM connectivity
  const vllmUrl = (() => {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      return config.vllm?.baseURL || "http://localhost:8001/v1";
    } catch {
      return "http://localhost:8001/v1";
    }
  })();

  try {
    const res = await fetch(`${vllmUrl}/models`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json() as any;
      const models = data.data?.map((m: any) => m.id).join(", ") || "unknown";
      console.log(`  ✅ vLLM reachable at ${vllmUrl}`);
      console.log(`     Models: ${models}`);
    } else {
      console.log(`  ⚠️  vLLM responded with status ${res.status}`);
      allOk = false;
    }
  } catch {
    console.log(`  ⚠️  vLLM not reachable at ${vllmUrl}`);
    console.log("     Start vLLM: oh-my-qwencoder start-vllm");
    // Not setting allOk=false — vLLM can be started later
  }

  // 4. Check opencode CLI
  try {
    const { execSync } = await import("node:child_process");
    execSync("which opencode", { stdio: "pipe" });
    console.log("  ✅ opencode CLI found");
  } catch {
    console.log("  ❌ opencode CLI not found. Install: curl -fsSL https://opencode.ai/install | bash");
    allOk = false;
  }

  console.log(allOk ? "\n✅ All checks passed!\n" : "\n⚠️  Some checks failed. See above.\n");
}
