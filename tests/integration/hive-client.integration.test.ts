import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

// Imports the built package (same entry point real consumers resolve)
// rather than src/, so these tests exercise what actually ships.
import { HiveClient, HiveClientError, StatusEnum } from "../../dist/index.js";
import { HIVE_TEST_URL, login } from "./helpers.ts";

describe("HiveClient integration (real Hive)", () => {
    let client: HiveClient;
    let reachable = false;
    let skipReason = "";

    // Login is the reachability check: any failure here (connection refused,
    // DNS, wrong creds, Hive still migrating) means "not usable right now" —
    // skip the suite instead of failing it, so `npm test` stays green
    // without a live Hive stack (e.g. running locally, outside CI).
    before(async () => {
        try {
            const { access, refresh } = await login();
            client = new HiveClient(access, refresh, HIVE_TEST_URL);
            reachable = true;
        } catch (error) {
            skipReason = `Hive not usable at ${HIVE_TEST_URL}: ${
                error instanceof Error ? error.message : String(error)
            }`;
        }
    });

    test("client.me.get() returns the logged-in admin", async (t) => {
        if (!reachable) return t.skip(skipReason);

        const me = await client.me.get();
        assert.equal(me.username, "admin");
    });

    test("client.getServerTime() returns the server clock", async (t) => {
        if (!reachable) return t.skip(skipReason);

        const time = await client.getServerTime();
        assert.equal(typeof time, "string");
        assert.ok(!Number.isNaN(Date.parse(time)), `not a parseable date: ${time}`);
    });

    test("client.class.list() returns Hive's seeded classes", async (t) => {
        if (!reachable) return t.skip(skipReason);

        const classes = await client.class.list();
        assert.ok(Array.isArray(classes));
    });

    test("tag: create -> get -> patch -> delete round-trips through real Hive", async (t) => {
        if (!reachable) return t.skip(skipReason);

        const created = await client.tag.create({ name: "integration-test-tag", color: "#ff00ff" });
        assert.equal(created.name, "integration-test-tag");

        const fetched = await client.tag.get(created.id);
        assert.equal(fetched.id, created.id);

        const patched = await client.tag.patch(created.id, { color: "#00ff00" });
        assert.equal(patched.color, "#00ff00");

        await client.tag.delete(created.id);
        await assert.rejects(() => client.tag.get(created.id), HiveClientError);
    });

    test("program -> subject -> module: nested create/delete against real Hive", async (t) => {
        if (!reachable) return t.skip(skipReason);

        const me = await client.me.get();

        const program = await client.program.create({
            name: `integration-test-program-${Date.now()}`,
            checker: me.id,
        });
        try {
            const subject = await client.subject.create({
                symbol: "ITP",
                name: "Integration Test Subject",
                parent_program: program.id,
                color: "#123456",
            });
            try {
                assert.equal(subject.parent_program, program.id);

                const module_ = await client.module.create({
                    name: "Integration Test Module",
                    parent_subject: subject.id,
                    order: "1",
                });
                assert.equal(module_.parent_subject, subject.id);
                await client.module.delete(module_.id);
            } finally {
                await client.subject.delete(subject.id);
            }
        } finally {
            await client.program.delete(program.id);
        }

        await assert.rejects(() => client.program.get(program.id), HiveClientError);
    });

    test("me.patch() persists a status change", async (t) => {
        if (!reachable) return t.skip(skipReason);

        const original = await client.me.get();
        try {
            const updated = await client.me.patch({ status: StatusEnum.Present });
            assert.equal(updated.status, StatusEnum.Present);
        } finally {
            await client.me.patch({ status: original.status });
        }
    });
});
