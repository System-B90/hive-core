import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";

import {
    HiveClient,
    HiveConnectionError,
    HiveError,
    classifyHiveNetworkError,
    lessonModuleId,
} from "../../dist/index.js";

const HIVE_URL = "https://hive.test";

/** A fetch rejection shaped like undici's, with the system error as `cause`. */
function fetchFailure(cause: Record<string, unknown>): TypeError {
    return new TypeError("fetch failed", { cause });
}

afterEach(() => {
    mock.restoreAll();
});

describe("classifyHiveNetworkError", () => {
    test("maps a DNS lookup failure to HiveConnectionError", () => {
        const result = classifyHiveNetworkError(
            fetchFailure({
                code: "ENOTFOUND",
                syscall: "getaddrinfo",
                hostname: "hive.nowhere",
            }),
        );
        assert.ok(result instanceof HiveConnectionError);
        assert.match(result.message, /hive\.nowhere/);
    });

    test("maps a TCP reset to HiveConnectionError", () => {
        const result = classifyHiveNetworkError(
            fetchFailure({ code: "ECONNRESET", host: "hive.test", port: 443 }),
        );
        assert.ok(result instanceof HiveConnectionError);
        assert.match(result.message, /hive\.test:443/);
    });

    test("maps a connect timeout to HiveConnectionError", () => {
        const result = classifyHiveNetworkError(
            fetchFailure({
                code: "CONNECT_TIMEOUT",
                address: "10.0.0.1",
                port: 443,
            }),
        );
        assert.ok(result instanceof HiveConnectionError);
        assert.match(result.message, /10\.0\.0\.1/);
    });

    test("passes HiveErrors and unrecognised errors through untouched", () => {
        const hiveError = new HiveError("already typed");
        assert.equal(classifyHiveNetworkError(hiveError), hiveError);

        const other = new Error("something else");
        assert.equal(classifyHiveNetworkError(other), other);
    });
});

describe("HiveClient network failures", () => {
    test("_request rethrows connection failures as HiveConnectionError", async () => {
        mock.method(globalThis, "fetch", async () => {
            throw fetchFailure({
                code: "ENOTFOUND",
                syscall: "getaddrinfo",
                hostname: "hive.test",
            });
        });
        const client = new HiveClient("access", undefined, HIVE_URL);

        await assert.rejects(client.getSubjects(), HiveConnectionError);
    });
});

describe("lesson module_id compatibility", () => {
    test("lesson writes send both module and module_id", async () => {
        const bodies: Array<unknown> = [];
        mock.method(
            globalThis,
            "fetch",
            async (_url: string, init?: RequestInit) => {
                bodies.push(JSON.parse(String(init?.body)));
                return new Response("{}", { status: 200 });
            },
        );
        const client = new HiveClient("access", undefined, HIVE_URL);

        await client.createLesson({ name: "L", module: 7 });
        await client.patchLesson("uuid-1", { module: 7 });
        await client.patchLesson(3, { name: "no module" });

        assert.deepEqual(bodies, [
            { name: "L", module: 7, module_id: 7 },
            { module: 7, module_id: 7 },
            { name: "no module" },
        ]);
    });

    test("lessonModuleId prefers module_id and falls back to module", () => {
        const base = {
            id: 1,
            name: "L",
            module: 4,
            module_order: "1",
            module_name: "M",
            subject_symbol: "S",
            subject_name: "S",
            program_name: "P",
        };
        assert.equal(lessonModuleId({ ...base, module_id: 9 }), 9);
        assert.equal(lessonModuleId(base), 4);
        assert.equal(lessonModuleId(undefined), undefined);
    });
});
