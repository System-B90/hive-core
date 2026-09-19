import assert from "node:assert/strict";
import { describe, test } from "node:test";

// Imports the built package (same entry point real consumers resolve) rather
// than src/, matching the other unit suites.
import {
    ApiNotImplementedError,
    ClientApiError,
    ClientApiWarning,
    ClientError,
    ForbiddenError,
    HiveClientError,
    HiveConnectionError,
    HiveError,
    OperationAborted,
    ServerNetworkError,
    UserNotLoggedInError,
    constructErrorFromNetworkMessage,
    parseNetworkConnectionResetError,
    parseNetworkHostNotFoundError,
    parseNetworkTimeoutError,
} from "../../dist/index.js";

describe("error hierarchy", () => {
    test("ClientError carries the message into `status`", () => {
        const error = new ClientError("boom");

        assert.ok(error instanceof Error);
        assert.equal(error.name, "ClientError");
        assert.equal(error.message, "boom");
        // Apps read `status` off the base class; it is deliberately the
        // message string, not an HTTP code.
        assert.equal(error.status, "boom");
    });

    test("ClientError without a message leaves `status` undefined", () => {
        assert.equal(new ClientError().status, undefined);
    });

    // Apps dispatch on `name`, so both the prototype chain and the tag matter.
    const cases: Array<{
        name: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctor: new (message?: any) => ClientError;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chain: Array<new (...args: any[]) => Error>;
    }> = [
        { name: "ServerNetworkError", ctor: ServerNetworkError, chain: [ClientError] },
        { name: "ClientApiError", ctor: ClientApiError, chain: [ClientError] },
        {
            name: "UserNotLoggedInError",
            ctor: UserNotLoggedInError,
            chain: [ClientApiError, ClientError],
        },
        {
            name: "ApiNotImplementedError",
            ctor: ApiNotImplementedError,
            chain: [ClientApiError, ClientError],
        },
        {
            name: "ClientApiWarning",
            ctor: ClientApiWarning,
            chain: [ClientApiError, ClientError],
        },
        {
            name: "OperationAborted",
            ctor: OperationAborted,
            chain: [ClientApiWarning, ClientApiError, ClientError],
        },
        {
            name: "HiveClientError",
            ctor: HiveClientError,
            chain: [ClientApiError, ClientError],
        },
        {
            name: "ForbiddenError",
            ctor: ForbiddenError,
            chain: [ClientApiError, ClientError],
        },
        { name: "HiveError", ctor: HiveError, chain: [ClientApiError, ClientError] },
        {
            name: "HiveConnectionError",
            ctor: HiveConnectionError,
            chain: [HiveError, ClientApiError, ClientError],
        },
    ];

    for (const { name, ctor, chain } of cases) {
        test(`${name} tags its name and keeps its instanceof chain`, () => {
            const error = new ctor("message");

            assert.equal(error.name, name);
            assert.equal(error.message, "message");
            assert.ok(error instanceof ctor);
            assert.ok(error instanceof Error);
            for (const ancestor of chain) {
                assert.ok(
                    error instanceof ancestor,
                    `${name} should be an instanceof ${ancestor.name}`,
                );
            }
        });
    }

    test("ServerNetworkError is not a ClientApiError", () => {
        // It branches off ClientError directly — apps that catch ClientApiError
        // must not swallow transport failures.
        assert.ok(!(new ServerNetworkError("x") instanceof ClientApiError));
    });
});

describe("ClientApiError copy-constructor", () => {
    test("carries structured fields through and preserves the source name", () => {
        const source = new ClientApiError("original");
        source.name = "CodedHiveError";
        Object.assign(source, { code: "E_SCHEDULE_CONFLICT", data: { eventId: 7 } });

        const copy = new ClientApiError(source);

        assert.equal(copy.message, "original");
        assert.equal(copy.name, "CodedHiveError");
        assert.equal((copy as unknown as { code: string }).code, "E_SCHEDULE_CONFLICT");
        assert.deepEqual(
            (copy as unknown as { data: unknown }).data,
            { eventId: 7 },
        );
        assert.ok(copy instanceof ClientApiError);
    });

    test("falls back to ClientApiError when the source has no name", () => {
        const source = new ClientApiError("original");
        // A plain JSON payload deserialised off the wire has no `name`.
        (source as unknown as { name?: string }).name = undefined;

        assert.equal(new ClientApiError(source).name, "ClientApiError");
    });

    test("a string message takes the plain branch", () => {
        const error = new ClientApiError("plain");

        assert.equal(error.name, "ClientApiError");
        assert.equal(error.message, "plain");
        assert.equal(error.status, "plain");
    });

    test("no argument yields a bare ClientApiError", () => {
        const error = new ClientApiError();

        assert.equal(error.message, "");
        // Neither branch runs, so the base class's tag survives.
        assert.equal(error.name, "ClientError");
    });

    test("constructErrorFromNetworkMessage rebuilds via the copy-constructor", () => {
        const source = new ClientApiError("wire failure");
        source.name = "UserNotLoggedInError";
        Object.assign(source, { code: 401 });

        const rebuilt = constructErrorFromNetworkMessage(source);

        assert.ok(rebuilt instanceof ClientApiError);
        assert.notEqual(rebuilt, source);
        assert.equal(rebuilt.name, "UserNotLoggedInError");
        assert.equal(rebuilt.message, "wire failure");
        assert.equal((rebuilt as unknown as { code: number }).code, 401);
    });
});

/** A fetch rejection shaped like undici's, with the system error as `cause`. */
function fetchFailure(cause: Record<string, unknown>): TypeError {
    return new TypeError("fetch failed", { cause });
}

describe("parseNetworkHostNotFoundError", () => {
    test("extracts the hostname from a DNS lookup failure", () => {
        assert.deepEqual(
            parseNetworkHostNotFoundError(
                fetchFailure({
                    code: "ENOTFOUND",
                    syscall: "getaddrinfo",
                    hostname: "hive.nowhere",
                }),
            ),
            { code: "ENOTFOUND", syscall: "getaddrinfo", hostname: "hive.nowhere" },
        );
    });

    test("reads the fields off the error itself when there is no cause", () => {
        const error = Object.assign(new Error("getaddrinfo ENOTFOUND hive.nowhere"), {
            code: "ENOTFOUND",
            syscall: "getaddrinfo",
            hostname: "hive.nowhere",
        });

        assert.equal(parseNetworkHostNotFoundError(error)?.hostname, "hive.nowhere");
    });

    test("rejects a non-Error input", () => {
        assert.equal(
            parseNetworkHostNotFoundError({
                code: "ENOTFOUND",
                syscall: "getaddrinfo",
                hostname: "hive.nowhere",
            }),
            undefined,
        );
    });

    test("rejects a different error code", () => {
        assert.equal(
            parseNetworkHostNotFoundError(
                fetchFailure({
                    code: "ECONNREFUSED",
                    syscall: "getaddrinfo",
                    hostname: "hive.nowhere",
                }),
            ),
            undefined,
        );
    });

    test("rejects a different syscall", () => {
        assert.equal(
            parseNetworkHostNotFoundError(
                fetchFailure({
                    code: "ENOTFOUND",
                    syscall: "connect",
                    hostname: "hive.nowhere",
                }),
            ),
            undefined,
        );
    });

    test("rejects a missing or non-string hostname", () => {
        assert.equal(
            parseNetworkHostNotFoundError(
                fetchFailure({ code: "ENOTFOUND", syscall: "getaddrinfo" }),
            ),
            undefined,
        );
        assert.equal(
            parseNetworkHostNotFoundError(
                fetchFailure({
                    code: "ENOTFOUND",
                    syscall: "getaddrinfo",
                    hostname: 42,
                }),
            ),
            undefined,
        );
    });
});

describe("parseNetworkConnectionResetError", () => {
    test("extracts host and port from a TCP reset", () => {
        assert.deepEqual(
            parseNetworkConnectionResetError(
                fetchFailure({ code: "ECONNRESET", host: "hive.test", port: 443 }),
            ),
            { host: "hive.test", code: "ECONNRESET", port: 443 },
        );
    });

    test("rejects a non-Error input", () => {
        assert.equal(
            parseNetworkConnectionResetError({
                code: "ECONNRESET",
                host: "hive.test",
                port: 443,
            }),
            undefined,
        );
    });

    test("rejects an absent cause", () => {
        assert.equal(
            parseNetworkConnectionResetError(new Error("socket hang up")),
            undefined,
        );
    });

    test("rejects a different error code", () => {
        assert.equal(
            parseNetworkConnectionResetError(
                fetchFailure({ code: "ECONNREFUSED", host: "hive.test", port: 443 }),
            ),
            undefined,
        );
    });

    test("rejects a non-string host or non-numeric port", () => {
        assert.equal(
            parseNetworkConnectionResetError(
                fetchFailure({ code: "ECONNRESET", host: null, port: 443 }),
            ),
            undefined,
        );
        assert.equal(
            parseNetworkConnectionResetError(
                fetchFailure({ code: "ECONNRESET", host: "hive.test", port: "443" }),
            ),
            undefined,
        );
    });
});

describe("parseNetworkTimeoutError", () => {
    test("maps `address` onto `host` for a connect timeout", () => {
        assert.deepEqual(
            parseNetworkTimeoutError(
                fetchFailure({
                    code: "CONNECT_TIMEOUT",
                    address: "10.0.0.5",
                    port: 443,
                }),
            ),
            { host: "10.0.0.5", code: "CONNECT_TIMEOUT", port: 443 },
        );
    });

    test("rejects a non-Error input", () => {
        assert.equal(
            parseNetworkTimeoutError({
                code: "CONNECT_TIMEOUT",
                address: "10.0.0.5",
                port: 443,
            }),
            undefined,
        );
    });

    test("rejects an absent cause", () => {
        assert.equal(parseNetworkTimeoutError(new Error("timed out")), undefined);
    });

    test("rejects a different error code", () => {
        assert.equal(
            parseNetworkTimeoutError(
                fetchFailure({
                    code: "UND_ERR_CONNECT_TIMEOUT",
                    address: "10.0.0.5",
                    port: 443,
                }),
            ),
            undefined,
        );
    });

    test("rejects a missing address or non-numeric port", () => {
        assert.equal(
            parseNetworkTimeoutError(
                fetchFailure({ code: "CONNECT_TIMEOUT", port: 443 }),
            ),
            undefined,
        );
        assert.equal(
            parseNetworkTimeoutError(
                fetchFailure({
                    code: "CONNECT_TIMEOUT",
                    address: "10.0.0.5",
                    port: "443",
                }),
            ),
            undefined,
        );
    });
});
