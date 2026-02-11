import { getSession, deleteSession } from "../tools/session.js";
export async function eventHook({ event }) {
    const sid = event.session_id || event.sessionID;
    if (event.type === "session.created" && sid)
        getSession(sid);
    if (event.type === "session.deleted" && sid)
        deleteSession(sid);
}
//# sourceMappingURL=event.js.map