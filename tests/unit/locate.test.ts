import assert from "node:assert/strict";
import { test } from "node:test";

// Mirrors pyhive tests/test_locate.py; keep the cases in sync.
import { resolveLocation } from "../../dist/index.js";

const T = new Date("2026-09-27T10:00:00Z");
const ROOMS = [100, 101, 102];
const at = (h: number): string => `2026-09-27T${String(h).padStart(2, "0")}:00:00Z`;
const ev = (id: string, room: null | number, attendees: Array<number>, s: number, e: number) => ({
    id,
    room_id: room,
    attendees: attendees.map((a) => ({ id: a })),
    start: at(s),
    end: at(e),
});

test("event room beats home room", () => {
    assert.deepEqual(resolveLocation([100, 7], ROOMS, [ev("e1", 101, [7], 9, 11)], T), {
        roomId: 101, source: "event", eventId: "e1",
    });
});

test("falls back to home room", () => {
    const events = [ev("other", 101, [8], 9, 11), ev("ended", 102, [7], 8, 10)];
    assert.deepEqual(resolveLocation([100, 7], ROOMS, events, T), { roomId: 100, source: "home_room" });
});

test("ignores roomless events", () => {
    assert.deepEqual(resolveLocation([100, 7], ROOMS, [ev("e", null, [7], 9, 11)], T), {
        roomId: 100, source: "home_room",
    });
});

test("group match beats room match, then later start", () => {
    const events = [
        ev("by-room", 101, [100], 9, 11),
        ev("group-early", 102, [7], 8, 11),
        ev("group-late", 101, [7], 9, 11),
    ];
    assert.deepEqual(resolveLocation([100, 7], ROOMS, events, T), {
        roomId: 101, source: "event", eventId: "group-late",
    });
});

test("nowhere", () => {
    assert.equal(resolveLocation([7], ROOMS, [], T), null);
});
