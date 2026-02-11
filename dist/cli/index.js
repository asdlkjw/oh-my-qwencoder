import { argv } from "node:process";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
const command = argv[2];
const args = argv.slice(3);
async function main() {
    switch (command) {
        case "install":
            const { runInstall } = await import("./install.js");
            await runInstall(args);
            break;
        case "doctor":
            const { runDoctor } = await import("./doctor.js");
            await runDoctor(args);
            break;
        case "start-vllm": {
            const scriptPath = resolve(import.meta.dirname, "../../scripts/start-vllm.sh");
            try {
                execSync(`bash "${scriptPath}" ${args.join(" ")}`, { stdio: "inherit" });
            }
            catch (e) {
                process.exit(e.status || 1);
            }
            break;
        }
        case "help":
        case "--help":
        case "-h":
        case undefined:
            console.log(`
🛡️  oh-my-qwencoder — Parallel Development Swarm for self-hosted vLLM

Commands:
  install      Set up oh-my-qwencoder in the current project
  doctor       Check vLLM, opencode, and config health
  start-vllm   Start the vLLM server (scripts/start-vllm.sh)
  help         Show this help message

Usage:
  npx oh-my-qwencoder install
  npx oh-my-qwencoder doctor
  npx oh-my-qwencoder start-vllm
`);
            break;
        default:
            console.error(`Unknown command: ${command}`);
            console.error("Run 'oh-my-qwencoder help' for usage.");
            process.exit(1);
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map