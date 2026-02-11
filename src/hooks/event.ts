import { getSession, deleteSession } from "../tools/session.js";

export async function eventHook({ event }: { event: any }): Promise<void> {
  const sid = (event as any).session_id || (event as any).sessionID;
  if (event.type === "session.created" && sid) getSession(sid);
  if (event.type === "session.deleted" && sid) deleteSession(sid);
}
