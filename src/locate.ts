/**
 * Resolve which Hive room a student is in at a given time.
 *
 * Mirrored in pyhive `pyhive/locate.py`; keep the two in sync.
 * See pyhive `docs/locate-student.md` for the rules.
 */
import type { HiveClient } from "./client.js";
import { ClassTypeEnum } from "./types.js";

/** Events are fetched this far either side of `at`: the API filters by containment, not overlap. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** The Segel event shape (`EventSegel` serializer) — the fields the resolver reads. */
export type LocatableEvent = {
    id: string;
    start: string;
    end: string;
    room_id: null | number;
    attendees: Array<{ id: number }>;
};

export type RoomLocation = {
    roomId: number;
    source: "event" | "home_room";
    eventId?: string;
};

/** Pure resolver: a roomed event covering `at` wins, else the home room. */
export function resolveLocation(
    classIds: Iterable<number>,
    roomIds: Iterable<number>,
    events: Iterable<LocatableEvent>,
    at: Date,
): null | RoomLocation {
    const mine = new Set(classIds);
    const rooms = new Set(roomIds);
    const t = at.getTime();
    let best: { event: LocatableEvent; specific: number; start: number } | undefined;
    for (const event of events) {
        const start = Date.parse(event.start);
        if (event.room_id === null || !(start <= t && t < Date.parse(event.end))) continue;
        const matched = event.attendees.map((a) => a.id).filter((id) => mine.has(id));
        if (matched.length === 0) continue;
        // A student-group match is more specific than a whole-room match;
        // among equals the later start wins, like bluz's lesson activation.
        const specific = matched.some((id) => !rooms.has(id)) ? 1 : 0;
        if (!best || specific > best.specific || (specific === best.specific && start > best.start)) {
            best = { event, specific, start };
        }
    }
    if (best) return { roomId: best.event.room_id as number, source: "event", eventId: best.event.id };
    const home = [...mine].filter((id) => rooms.has(id)).sort((a, b) => a - b);
    return home.length ? { roomId: home[0], source: "home_room" } : null;
}

/** Fetch what {@link resolveLocation} needs and resolve. Needs a Segel client. */
export async function locateStudent(
    client: HiveClient,
    studentId: number,
    at: Date,
): Promise<null | RoomLocation> {
    const [students, rooms, events] = await Promise.all([
        client.getUsers({ id__in: studentId }),
        client.getClasses(ClassTypeEnum.Room),
        client.getScheduleEvents({
            start__gte: new Date(at.getTime() - WINDOW_MS).toISOString(),
            end__lte: new Date(at.getTime() + WINDOW_MS).toISOString(),
        }) as unknown as Promise<Array<LocatableEvent>>,
    ]);
    const student = students.find((s) => s.id === studentId);
    if (!student) return null;
    return resolveLocation(student.classes ?? [], rooms.map((r) => r.id), events, at);
}
