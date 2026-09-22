import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

// Imports the built package (same entry point real consumers resolve) rather
// than src/, matching the other unit suites.
import { HiveClient, HiveClientError, isTimeoutError } from "../../dist/index.js";

const HIVE_URL = "https://hive.test";

type Call = { url: string; init?: RequestInit };
type Reply = { status?: number; body?: unknown; text?: string; statusText?: string };

/**
 * Replaces global fetch and records what was asked for.
 *
 * `responder` receives the call plus its 0-based index so a test can script a
 * sequence (401 then 200, 500 x4, …) without keeping its own counter.
 */
function stubFetch(responder: (call: Call, index: number) => Reply): Call[] {
    const calls: Call[] = [];
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
        const call = { url: String(url), init };
        const reply = responder(call, calls.length);
        calls.push(call);
        const { status = 200, body, text, statusText } = reply;
        const payload = text !== undefined ? text : JSON.stringify(body ?? {});
        return new Response(status === 204 ? null : payload, {
            status,
            statusText,
            headers: { "Content-Type": "application/json" },
        });
    });
    return calls;
}

/**
 * Runs the backoff sleeps instantly while recording the delays the transport
 * asked for, so the 200/400/800 schedule is asserted without real waits.
 */
function stubTimers(): number[] {
    const delays: number[] = [];
    mock.method(
        globalThis,
        "setTimeout",
        (callback: () => void, delay?: number) => {
            delays.push(delay ?? 0);
            callback();
            return 0 as unknown as ReturnType<typeof setTimeout>;
        },
    );
    return delays;
}

/** Re-exposes the protected transport surface the issue asks us to pin. */
class ProbeClient extends HiveClient {
    url(path: string): string {
        return this.buildUrl(path);
    }
    refresh(): Promise<void> {
        return this.refreshAccessToken();
    }
    request<T>(url: string, method = "GET" as const, body?: unknown): Promise<T> {
        return this._request<T>(url, method, body);
    }
    get access(): string {
        return this.accessToken;
    }
    get refreshValue(): string | undefined {
        return this.refreshTokenValue;
    }
    get baseUrl(): string {
        return this.hiveBaseUrl;
    }
}

function client(refreshToken?: string, baseUrl: string | undefined = HIVE_URL) {
    return new ProbeClient("acc", refreshToken, baseUrl);
}

/** Parses the JSON body a recorded call was made with. */
function bodyOf(call: Call): unknown {
    return JSON.parse(String(call.init?.body));
}

afterEach(() => {
    mock.restoreAll();
    delete process.env.NEXT_PUBLIC_HIVE_URL;
});

describe("buildUrl and the base-URL fallback", () => {
    test("joins the path onto the configured base URL", () => {
        assert.equal(client().url("/api/core/help/"), `${HIVE_URL}/api/core/help/`);
    });

    test("strips a single trailing slash from the base URL", () => {
        assert.equal(
            client(undefined, `${HIVE_URL}/`).url("/api/core/help/"),
            `${HIVE_URL}/api/core/help/`,
        );
    });

    test("falls back to NEXT_PUBLIC_HIVE_URL when no base URL is passed", () => {
        process.env.NEXT_PUBLIC_HIVE_URL = "https://hive.env";

        // Constructed directly: the helper's default would mask the omission.
        assert.equal(new ProbeClient("acc").baseUrl, "https://hive.env");
    });

    test("falls back to an empty base URL when the env var is unset too", () => {
        assert.equal(new ProbeClient("acc").baseUrl, "");
    });
});

describe("refreshAccessToken", () => {
    test("throws when there is no refresh token", async () => {
        await assert.rejects(client(undefined).refresh(), HiveClientError);
    });

    test("POSTs the refresh token to Hive's refresh endpoint", async () => {
        const calls = stubFetch(() => ({ body: { access: "acc2" } }));

        await client("ref").refresh();

        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, `${HIVE_URL}/api/core/token/refresh/`);
        assert.equal(calls[0].init?.method, "POST");
        assert.deepEqual(bodyOf(calls[0]), { refresh: "ref" });
    });

    test("stores the rotated access token", async () => {
        stubFetch(() => ({ body: { access: "acc2" } }));
        const hive = client("ref");

        await hive.refresh();

        assert.equal(hive.access, "acc2");
        // No new refresh token in the response — the old one stays in place.
        assert.equal(hive.refreshValue, "ref");
    });

    test("stores a rotated refresh token when Hive returns one", async () => {
        stubFetch(() => ({ body: { access: "acc2", refresh: "ref2" } }));
        const hive = client("ref");

        await hive.refresh();

        assert.equal(hive.refreshValue, "ref2");
    });

    test("throws when the refresh endpoint rejects the token", async () => {
        stubFetch(() => ({ status: 401 }));

        await assert.rejects(client("ref").refresh(), HiveClientError);
    });
});

describe("_request", () => {
    test("sends bearer auth, the content type and a serialised body", async () => {
        const calls = stubFetch(() => ({ body: { ok: true } }));

        await client().request(`${HIVE_URL}/api/core/help/`, "GET", { a: 1 });

        const headers = new Headers(calls[0].init?.headers);
        assert.equal(headers.get("Authorization"), "Bearer acc");
        assert.equal(headers.get("Content-Type"), "application/json");
        assert.deepEqual(bodyOf(calls[0]), { a: 1 });
    });

    test("omits the body entirely when none is given", async () => {
        const calls = stubFetch(() => ({ body: {} }));

        await client().request(`${HIVE_URL}/api/core/help/`);

        assert.equal(calls[0].init?.body, undefined);
    });

    test("refreshes once on 401 and retries with the new token", async () => {
        const calls = stubFetch((call, index) => {
            if (index === 0) return { status: 401 };
            if (call.url.endsWith("/token/refresh/")) {
                return { body: { access: "acc2" } };
            }
            return { body: { ok: true } };
        });

        const result = await client("ref").request(`${HIVE_URL}/api/core/help/`);

        assert.deepEqual(result, { ok: true });
        assert.equal(calls.length, 3);
        assert.ok(calls[1].url.endsWith("/api/core/token/refresh/"));
        assert.equal(
            new Headers(calls[2].init?.headers).get("Authorization"),
            "Bearer acc2",
        );
    });

    test("throws when the retried request is still 401", async () => {
        const calls = stubFetch((call) =>
            call.url.endsWith("/token/refresh/")
                ? { body: { access: "acc2" } }
                : { status: 401 },
        );

        await assert.rejects(
            client("ref").request(`${HIVE_URL}/api/core/help/`),
            HiveClientError,
        );
        // Original, refresh, retry — and no second refresh.
        assert.equal(calls.length, 3);
    });

    test("throws on 401 without ever refreshing when no refresh token exists", async () => {
        const calls = stubFetch(() => ({ status: 401 }));

        await assert.rejects(
            client(undefined).request(`${HIVE_URL}/api/core/help/`),
            HiveClientError,
        );
        assert.equal(calls.length, 1);
    });

    test("retries a 500 three times with 200/400/800ms backoff, then throws", async () => {
        const delays = stubTimers();
        const calls = stubFetch(() => ({ status: 500, statusText: "Server Error" }));

        await assert.rejects(
            client().request(`${HIVE_URL}/api/core/help/`),
            (error: unknown) => {
                assert.ok(error instanceof HiveClientError);
                // The message embeds the attempt count consumers surface.
                assert.match(error.message, /3/);
                return true;
            },
        );

        assert.equal(calls.length, 4, "one original request plus three retries");
        assert.deepEqual(delays, [200, 400, 800]);
    });

    test("stops retrying as soon as a 500 clears", async () => {
        const delays = stubTimers();
        const calls = stubFetch((_call, index) =>
            index === 0 ? { status: 500 } : { body: { ok: true } },
        );

        assert.deepEqual(
            await client().request(`${HIVE_URL}/api/core/help/`),
            { ok: true },
        );
        assert.equal(calls.length, 2);
        assert.deepEqual(delays, [200]);
    });

    test("throws with the status text on any other non-ok status", async () => {
        stubFetch(() => ({ status: 403, statusText: "Forbidden" }));

        await assert.rejects(
            client().request(`${HIVE_URL}/api/core/help/`),
            (error: unknown) => {
                assert.ok(error instanceof HiveClientError);
                assert.match(error.message, /Forbidden/);
                return true;
            },
        );
    });

    test("returns undefined for 204 without parsing a body", async () => {
        stubFetch(() => ({ status: 204 }));
        const parse = mock.method(JSON, "parse");

        assert.equal(await client().request(`${HIVE_URL}/api/core/help/`), undefined);
        assert.equal(parse.mock.callCount(), 0);
    });

    test("returns undefined for a 200 with an empty body", async () => {
        stubFetch(() => ({ text: "" }));

        assert.equal(await client().request(`${HIVE_URL}/api/core/help/`), undefined);
    });
});

describe("fetchWithTokenCookie", () => {
    test("sets the token cookie and preserves the caller's headers", async () => {
        const calls = stubFetch(() => ({ body: {} }));

        await client().fetchWithTokenCookie(`${HIVE_URL}/prometheus/api/v1/query`, {
            headers: { Accept: "application/json" },
        });

        const headers = new Headers(calls[0].init?.headers);
        assert.equal(headers.get("Cookie"), "token=acc");
        assert.equal(headers.get("Accept"), "application/json");
    });

    test("forwards the rest of init untouched", async () => {
        const calls = stubFetch(() => ({ body: {} }));

        await client().fetchWithTokenCookie(`${HIVE_URL}/x`, {
            method: "POST",
            body: "query=up",
        });

        assert.equal(calls[0].init?.method, "POST");
        assert.equal(calls[0].init?.body, "query=up");
    });

    test("refreshes once on 401 and retries with the new token", async () => {
        const calls = stubFetch((call, index) => {
            if (index === 0) return { status: 401 };
            if (call.url.endsWith("/token/refresh/")) {
                return { body: { access: "acc2" } };
            }
            return { body: { ok: true } };
        });

        const response = await client("ref").fetchWithTokenCookie(`${HIVE_URL}/x`);

        assert.equal(response.status, 200);
        assert.equal(calls.length, 3);
        assert.equal(
            new Headers(calls[2].init?.headers).get("Cookie"),
            "token=acc2",
        );
    });

    test("returns the raw 401 response once the retry is exhausted", async () => {
        // Deliberately divergent from `_request`, which throws: callers of this
        // helper proxy Hive-hosted services and want the status, not an
        // exception. Pinned so the divergence stays a decision, not a drift.
        const calls = stubFetch((call) =>
            call.url.endsWith("/token/refresh/")
                ? { body: { access: "acc2" } }
                : { status: 401 },
        );

        const response = await client("ref").fetchWithTokenCookie(`${HIVE_URL}/x`);

        assert.equal(response.status, 401);
        assert.equal(calls.length, 3);
    });

    test("returns the raw 401 response when there is no refresh token", async () => {
        const calls = stubFetch(() => ({ status: 401 }));

        const response = await client(undefined).fetchWithTokenCookie(`${HIVE_URL}/x`);

        assert.equal(response.status, 401);
        assert.equal(calls.length, 1);
    });
});

describe("isTimeoutError", () => {
    test("accepts a TypeError whose cause carries a name", () => {
        assert.equal(
            isTimeoutError(new TypeError("fetch failed", { cause: { name: "TimeoutError" } })),
            true,
        );
    });

    test("rejects a plain Error even with a well-formed cause", () => {
        assert.equal(
            isTimeoutError(new Error("fetch failed", { cause: { name: "TimeoutError" } })),
            false,
        );
    });

    test("rejects a TypeError with no cause", () => {
        assert.equal(isTimeoutError(new TypeError("fetch failed")), false);
    });

    test("rejects a non-object or null cause", () => {
        assert.equal(isTimeoutError(new TypeError("x", { cause: "TimeoutError" })), false);
        assert.equal(isTimeoutError(new TypeError("x", { cause: null })), false);
    });

    test("rejects a cause whose name is absent or not a string", () => {
        assert.equal(isTimeoutError(new TypeError("x", { cause: {} })), false);
        assert.equal(isTimeoutError(new TypeError("x", { cause: { name: 7 } })), false);
    });

    test("rejects a non-Error value", () => {
        assert.equal(isTimeoutError({ name: "TypeError", cause: { name: "x" } }), false);
    });
});

describe("getOpenHelpsCount", () => {
    let calls: Call[];

    beforeEach(() => {
        calls = stubFetch(() => ({ body: { count: 12 } }));
    });

    test("requests a single-row Open query and returns the count", async () => {
        assert.equal(await client().getOpenHelpsCount(), 12);

        const url = new URL(calls[0].url);
        assert.equal(url.pathname, "/api/core/help/");
        assert.equal(url.searchParams.get("limit"), "1");
        assert.equal(url.searchParams.get("help_status__in"), "Open");
    });

    test("throws when `count` is missing", async () => {
        mock.restoreAll();
        stubFetch(() => ({ body: {} }));

        await assert.rejects(client().getOpenHelpsCount(), HiveClientError);
    });

    test("throws when `count` is not a finite number", async () => {
        mock.restoreAll();
        stubFetch(() => ({ body: { count: "12" } }));

        await assert.rejects(client().getOpenHelpsCount(), HiveClientError);
    });
});
