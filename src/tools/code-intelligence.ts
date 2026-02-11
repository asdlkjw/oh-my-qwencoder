import { tool } from "@opencode-ai/plugin";
import { getSession } from "./session.js";

type ShellFn = (strings: TemplateStringsArray, ...values: any[]) => { text(): Promise<string> };

export function createCodeIntelTools($: ShellFn) {
  return {
    project_overview: tool({
      description: "Analyze project structure and tech stack.",
      args: {},
      async execute(_, ctx) {
        getSession(ctx.sessionID).explorationCount++;
        const parts: string[] = [];
        try {
          parts.push(`## Structure\n\`\`\`\n${await $`find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/__pycache__/*' | sort | head -100`.text()}\n\`\`\``);
        } catch {}
        const configs: Record<string, string> = {
          "package.json": "Node.js", "tsconfig.json": "TypeScript", "pyproject.toml": "Python",
          "Cargo.toml": "Rust", "go.mod": "Go", "docker-compose.yml": "Docker",
        };
        const found: string[] = [];
        for (const [f, s] of Object.entries(configs)) {
          try { await $`test -e ${f}`.text(); found.push(`- **${s}** (${f})`); } catch {}
        }
        if (found.length) parts.push(`## Stack\n${found.join("\n")}`);
        try {
          const pkg = JSON.parse(await $`cat package.json`.text());
          if (pkg.scripts) parts.push(`## Scripts\n\`\`\`\n${Object.entries(pkg.scripts).map(([k, v]) => `${k}: ${v}`).join("\n")}\n\`\`\``);
        } catch {}
        try {
          const b = await $`git branch --show-current`.text();
          parts.push(`## Git\nBranch: ${b.trim()}\n${await $`git log --oneline -5`.text()}`);
        } catch {}
        return parts.join("\n\n") || "Could not analyze";
      },
    }),

    find_references: tool({
      description: "Find symbol references across codebase",
      args: { symbol: tool.schema.string(), pattern: tool.schema.string().default("*") },
      async execute({ symbol, pattern }, ctx) {
        getSession(ctx.sessionID).explorationCount++;
        try {
          const inc = pattern !== "*" ? `--include="${pattern}"` : "";
          return await $`sh -c 'grep -rn ${inc} --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git "${symbol}" . | head -60'`.text() || "No refs";
        } catch { return "No refs"; }
      },
    }),

    ast_grep_search: tool({
      description: "AST structural search. e.g. 'console.log($$$)'",
      args: {
        pattern: tool.schema.string(),
        lang: tool.schema.enum(["typescript", "javascript", "python", "rust", "go", "java"]),
        path: tool.schema.string().default("."),
      },
      async execute({ pattern, lang, path }) {
        try {
          return await $`sg scan --pattern "${pattern}" --lang ${lang} ${path} 2>/dev/null | head -80`.text() || "No matches";
        } catch { return "ast-grep not installed. npm i -g @ast-grep/cli"; }
      },
    }),
  };
}
