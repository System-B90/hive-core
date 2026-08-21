import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";

// Imports the built package (same entry point real consumers resolve) rather
// than src/, matching the integration suite.
import {
    HiveClient,
    HiveClientError,
    createHiveServiceClient,
    obtainHiveServiceTokens,
    resetHiveServiceClientCache,
} from "../../dist/index.js";

const HIVE_URL = "https://hive.test";
const CREDENTIALS = {
    username: "svc",
    password: "secret",
    hiveBaseUrl: HIVE_URL,
};

type Call = { url: string; init?: RequestInit };

/**
 * Replaces global fetch and records what was asked for.
 *
 * These run without a live Hive on purpose: the caching and TTL logic is the
 * part most likely to break, and an integration test cannot exercise it
 * without a real service account provisioned in Hive.
 */
function stubFetch(
    responder: (call: Call) => { status?: number; body?: unknown },
): Call[] {
    const calls: Call[] = [];
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
        const call = { url: String(url), init };
        calls.push(call);
        const { status = 200, body = {} } = responder(call);
        return new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
        });
    });
    return calls;
}

afterEach(() => {
    mock.restoreAll();
    resetHiveServiceClientCache();
    delete process.env.HIVE_ACCESS_TOKEN_LIFETIME_MINUTES;
});

describe("obtainHiveServiceTokens", () => {
    test("posts the credentials to Hive's plain JWT endpoint", async () => {
        const calls = stubFetch(() => ({
            body: { access: "acc", refresh: "ref" },
        }));

        const tokens = await obtainHiveServiceTokens(CREDENTIALS);

        assert.deepEqual(tokens, { access: "acc", refresh: "ref" });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, `${HIVE_URL}/api/core/token/`);
        assert.equal(calls[0].init?.method, "POST");
        assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
            username: "svc",
            password: "secret",
        });
    });

    test("does not double the slash when the base URL has a trailing one", async () => {
        const calls = stubFetch(() => ({ body: { access: "acc" } }));

        await obtainHiveServiceTokens({
            ...CREDENTIALS,
            hiveBaseUrl: `${HIVE_URL}/`,
        });

        assert.equal(calls[0].url, `${HIVE_URL}/api/core/token/`);
    });

    test("falls back to NEXT_PUBLIC_HIVE_URL", async () => {
        const previous = process.env.NEXT_PUBLIC_HIVE_URL;
        process.env.NEXT_PUBLIC_HIVE_URL = HIVE_URL;
        const calls = stubFetch(() => ({ body: { access: "acc" } }));

        try {
            await obtainHiveServiceTokens({
                username: "svc",
                password: "secret",
            });
            assert.equal(calls[0].url, `${HIVE_URL}/api/core/token/`);
        } finally {
            if (previous === undefined) delete process.env.NEXT_PUBLIC_HIVE_URL;
            else process.env.NEXT_PUBLIC_HIVE_URL = previous;
        }
    });

    test("raises HiveClientError when Hive rejects the credentials", async () => {
        stubFetch(() => ({ status: 401, body: { detail: "no" } }));

        await assert.rejects(
            () => obtainHiveServiceTokens(CREDENTIALS),
            (error: unknown) => {
                assert.ok(error instanceof HiveClientError);
                assert.match(String((error as Error).message), /401/);
                return true;
            },
        );
    });

    test("raises when Hive answers 200 without an access token", async () => {
        // A 200 carrying no token is not a usable login, and letting it
        // through produces a client that 401s on every later call instead.
        stubFetch(() => ({ body: { refresh: "ref" } }));

        await assert.rejects(
            () => obtainHiveServiceTokens(CREDENTIALS),
            HiveClientError,
        );
    });
});

describe("createHiveServiceClient", () => {
    test("returns a HiveClient carrying the issued token", async () => {
        stubFetch(() => ({ body: { access: "acc", refresh: "ref" } }));

        const client = await createHiveServiceClient(CREDENTIALS);

        assert.ok(client instanceof HiveClient);
    });

    test("reuses the cached client instead of logging in again", async () => {
        const calls = stubFetch(() => ({ body: { access: "acc" } }));

        const first = await createHiveServiceClient(CREDENTIALS);
        const second = await createHiveServiceClient(CREDENTIALS);

        assert.equal(first, second);
        // One login, not two: a service account makes many small calls.
        assert.equal(calls.length, 1);
    });

    test("caches per account, not globally", async () => {
        const calls = stubFetch(() => ({ body: { access: "acc" } }));

        const a = await createHiveServiceClient(CREDENTIALS);
        const b = await createHiveServiceClient({
            ...CREDENTIALS,
            username: "other",
        });

        assert.notEqual(a, b);
        assert.equal(calls.length, 2);
    });

    test("caches per Hive URL, not just per username", async () => {
        const calls = stubFetch(() => ({ body: { access: "acc" } }));

        await createHiveServiceClient(CREDENTIALS);
        await createHiveServiceClient({
            ...CREDENTIALS,
            hiveBaseUrl: "https://other.test",
        });

        assert.equal(calls.length, 2);
    });

    test("cache: false forces a fresh login", async () => {
        const calls = stubFetch(() => ({ body: { access: "acc" } }));

        await createHiveServiceClient(CREDENTIALS);
        await createHiveServiceClient({ ...CREDENTIALS, cache: false });

        assert.equal(calls.length, 2);
    });

    test("resetHiveServiceClientCache drops one account's entry", async () => {
        const calls = stubFetch(() => ({ body: { access: "acc" } }));

        await createHiveServiceClient(CREDENTIALS);
        const other = { ...CREDENTIALS, username: "other" };
        await createHiveServiceClient(other);
        resetHiveServiceClientCache(CREDENTIALS);

        await createHiveServiceClient(other); // still cached
        assert.equal(calls.length, 2);

        await createHiveServiceClient(CREDENTIALS); // evicted, logs in again
        assert.equal(calls.length, 3);
    });

    test("logs in again once the cached client outlives the token lifetime", async (t) => {
        // The TTL is pinned to Hive's ACCESS_TOKEN_LIFETIME less a minute of
        // margin, so a cached client never hands out a token that expires
        // mid-flight. Without this, the cache would happily serve a dead token.
        process.env.HIVE_ACCESS_TOKEN_LIFETIME_MINUTES = "60";
        const calls = stubFetch(() => ({ body: { access: "acc" } }));
        t.mock.timers.enable({ apis: ["Date"], now: 0 });

        await createHiveServiceClient(CREDENTIALS);
        t.mock.timers.tick(58 * 60 * 1000); // inside the 59-minute TTL
        await createHiveServiceClient(CREDENTIALS);
        assert.equal(calls.length, 1);

        t.mock.timers.tick(2 * 60 * 1000); // past it
        await createHiveServiceClient(CREDENTIALS);
        assert.equal(calls.length, 2);
    });
});

describe("HiveClient.getQueues", () => {
    test("asks for every queue when unscoped", async () => {
        const calls = stubFetch(() => ({ body: [] }));
        const client = new HiveClient("acc", "ref", HIVE_URL);

        await client.getQueues();

        assert.ok(calls[0].url.endsWith("/api/core/queues/"));
    });

    test("scopes to one module when asked", async () => {
        // Hive rejects user queues on a lesson rule, so an unscoped list
        // offers choices that cannot be saved.
        const calls = stubFetch(() => ({ body: [] }));
        const client = new HiveClient("acc", "ref", HIVE_URL);

        await client.getQueues({ module: 42 });

        assert.ok(calls[0].url.endsWith("/api/core/queues/?module=42"));
    });
});
