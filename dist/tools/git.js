import { tool } from "@opencode-ai/plugin";
export function createGitTools($) {
    return {
        git_status: tool({
            description: "Git status",
            args: {},
            async execute() {
                try {
                    return `🔀 ${(await $ `git branch --show-current`.text()).trim()}\n${await $ `git status --short`.text() || "Clean"}`;
                }
                catch {
                    return "Not a git repo";
                }
            },
        }),
        git_diff: tool({
            description: "Show diff",
            args: { staged: tool.schema.boolean().default(false), file: tool.schema.string().optional() },
            async execute({ staged, file }) {
                try {
                    return await $ `sh -c 'git diff ${staged ? "--staged" : ""} ${file || ""} | head -300'`.text() || "No changes";
                }
                catch {
                    return "Failed";
                }
            },
        }),
        git_log: tool({
            description: "Git history",
            args: { count: tool.schema.number().default(10), search: tool.schema.string().optional() },
            async execute({ count, search }) {
                try {
                    const sf = search ? `-S "${search}"` : "";
                    return await $ `sh -c 'git log --oneline -${count} ${sf}'`.text() || "No commits";
                }
                catch {
                    return "Failed";
                }
            },
        }),
        git_commit: tool({
            description: "Atomic commit",
            args: { message: tool.schema.string(), files: tool.schema.string().optional() },
            async execute({ message, files }) {
                try {
                    await $ `sh -c '${files ? `git add ${files}` : "git add -A"}'`.text();
                    return `📦 ${await $ `git commit -m "${message}"`.text()}`;
                }
                catch (e) {
                    return `Failed: ${e}`;
                }
            },
        }),
    };
}
//# sourceMappingURL=git.js.map