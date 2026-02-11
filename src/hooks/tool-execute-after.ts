import { getSession } from "../tools/session.js";

export async function toolExecuteAfterHook(input: any): Promise<void> {
  const session = getSession(input.sessionID);
  if (input.tool === "edit" || input.tool === "write") {
    const p = (input.args?.filePath as string) || "";
    if (p && !session.filesModified.includes(p)) session.filesModified.push(p);
  }
}
