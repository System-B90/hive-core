import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

// Mirrors pyhive tests/test_locate.py::test_locate_student_live.
import { HiveClient, locateStudent } from "../../dist/index.js";
import { HIVE_TEST_URL, login } from "./helpers.ts";

describe("locateStudent (real Hive)", () => {
    let client: HiveClient;
    let token = "";
    let skipReason = "";
    const cleanup: Array<string> = [];
    const suffix = Math.random().toString(16).slice(2, 10);

    /** Seeds data hive-core has no create methods for. */
    async function post<T>(path: string, body: unknown): Promise<T> {
        const response = await fetch(`${HIVE_TEST_URL}/api/core/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`POST ${path}: ${response.status} ${await response.text()}`);
        return (await response.json()) as T;
    }

    before(async () => {
        try {
            const { access, refresh } = await login();
            token = access;
            client = new HiveClient(access, refresh, HIVE_TEST_URL);
        } catch (error) {
            skipReason = `Hive not usable at ${HIVE_TEST_URL}: ${String(error)}`;
        }
    });

    after(async () => {
        for (const path of cleanup.reverse()) {
            await fetch(`${HIVE_TEST_URL}/api/core/${path}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            }).catch(() => undefined);
        }
    });

    test("home room, then the room of an event the student's group attends", async (t) => {
        if (skipReason) return t.skip(skipReason);

        const checker = await post<{ id: number }>("management/users/", {
            username: `LocChecker-${suffix}`, password: "Password1", clearance: 3, gender: "NonBinary", status: "Present", mentees: [],
        });
        cleanup.push(`management/users/${checker.id}/`);
        const program = await post<{ id: number }>("course/programs/", {
            name: `LocProgram${suffix}`, checker: checker.id,
        });
        cleanup.push(`course/programs/${program.id}/`);
        const student = await post<{ id: number }>("management/users/", {
            username: `LocStudent-${suffix}`, password: "Password1", clearance: 1,
            gender: "NonBinary", status: "Present", mentees: [], program: program.id, number: 5000 + Math.floor(Math.random() * 4000),
        });
        cleanup.push(`management/users/${student.id}/`);
        const cls = async (name: string, type: string, users: Array<number>) =>
            await post<{ id: number }>("management/classes/", {
                name: `${name}-${suffix}`, program: program.id, type, users,
            });
        const home = await cls("LocHome", "Room", [student.id]);
        const lab = await cls("LocLab", "Room", []);
        const group = await cls("LocGroup", "Student Group", [student.id]);

        const now = new Date();
        assert.deepEqual(await locateStudent(client, student.id, now), {
            roomId: home.id, source: "home_room",
        });

        const event = await post<{ id: string }>("schedule/events/", {
            title: `LocEvent-${suffix}`,
            start: new Date(now.getTime() - 30 * 60_000).toISOString(),
            end: new Date(now.getTime() + 30 * 60_000).toISOString(),
            room_id: lab.id,
        });
        cleanup.push(`schedule/events/${event.id}/`);
        await post("schedule/event-attendees/", { event_id: event.id, attendee_class_id: group.id });

        assert.deepEqual(await locateStudent(client, student.id, now), {
            roomId: lab.id, source: "event", eventId: event.id,
        });
    });
});
