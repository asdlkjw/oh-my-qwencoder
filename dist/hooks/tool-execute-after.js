import { getSession } from "../tools/session.js";
export async function toolExecuteAfterHook(input) {
    const session = getSession(input.sessionID);
    if (input.tool === "edit" || input.tool === "write") {
        const p = input.args?.filePath || "";
        if (p && !session.filesModified.includes(p))
            session.filesModified.push(p);
    }
}
//# sourceMappingURL=tool-execute-after.js.map