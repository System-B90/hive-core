/*
 * Shared client/server error hierarchy for System-B15 apps.
 * Canonical source: Bluz `api-shared/errors`, folded with peek-a-boo's
 * Hive connection errors and network-error parsers.
 */

export class ClientError extends Error {
    status?: string;
    constructor(message?: string) {
        super(message);
        this.status = message;
        this.name = "ClientError";
    }
}

export class ServerNetworkError extends ClientError {
    constructor(message?: string) {
        super(message);
        this.name = "ServerNetworkError";
    }
}

export class ClientApiError extends ClientError {
    constructor(message?: ClientApiError | string) {
        super(typeof message === "string" ? message : message?.message);
        if (typeof message === "string") {
            this.name = "ClientApiError";
        } else if (message) {
            // Carry through any structured fields a server error payload adds
            // beyond name/message/status (e.g. a coded error's discriminant
            // and extra data), so subclasses can reconstruct the full shape
            // without every feature reimplementing fetch/parse logic.
            Object.assign(this, message);
            this.name = message.name ?? "ClientApiError";
        }
    }
}

export class UserNotLoggedInError extends ClientApiError {
    constructor(message?: string) {
        super(message);
        this.name = "UserNotLoggedInError";
    }
}

export function constructErrorFromNetworkMessage(
    networkMessage: ClientApiError,
): ClientApiError {
    return new ClientApiError(networkMessage);
}

export class ApiNotImplementedError extends ClientApiError {
    constructor(message?: string) {
        super(message);
        this.name = "ApiNotImplementedError";
    }
}

export class ClientApiWarning extends ClientApiError {
    constructor(message?: string) {
        super(message);
        this.name = "ClientApiWarning";
    }
}

export class OperationAborted extends ClientApiWarning {
    constructor(message?: string) {
        super(message);
        this.name = "OperationAborted";
    }
}

export class HiveClientError extends ClientApiError {
    constructor(message?: string) {
        super(message);
        this.name = "HiveClientError";
    }
}

export class ForbiddenError extends ClientApiError {
    constructor(message?: string) {
        super(message);
        this.name = "ForbiddenError";
    }
}

export class HiveError extends ClientApiError {
    constructor(message?: string) {
        super(message);
        this.name = "HiveError";
    }
}

export class HiveConnectionError extends HiveError {
    constructor(message?: string) {
        super(message);
        this.name = "HiveConnectionError";
    }
}

export function parseNetworkHostNotFoundError(error: unknown) {
    if (!(error instanceof Error)) {
        return;
    }
    const data:
        { code?: unknown; syscall?: unknown; hostname?: unknown } | unknown =
        typeof error.cause === "object" && error.cause !== null
            ? { ...error, ...error.cause }
            : { ...error };

    if (!(
        typeof data === "object" &&
        data !== null &&
        "code" in data &&
        "syscall" in data &&
        "hostname" in data
    )) {
        return;
    }

    const { code, syscall, hostname } = data;

    if (code !== "ENOTFOUND") {
        return;
    }
    if (syscall !== "getaddrinfo") {
        return;
    }
    if (typeof hostname !== "string") {
        return;
    }

    return {
        code: "ENOTFOUND",
        syscall,
        hostname,
    };
}

export function parseNetworkConnectionResetError(error: unknown) {
    if (!(error instanceof Error)) {
        return;
    }
    if (typeof error.cause !== "object" || error.cause === null) {
        return;
    }
    if (!("code" in error.cause)) {
        return;
    }
    if (error.cause.code !== "ECONNRESET") {
        return;
    }
    if (!("host" in error.cause)) {
        return;
    }
    if (typeof error.cause.host !== "string") {
        return;
    }
    if (!("port" in error.cause)) {
        return;
    }
    if (typeof error.cause.port !== "number") {
        return;
    }

    return {
        host: error.cause.host,
        code: error.cause.code,
        port: error.cause.port,
    };
}

export function parseNetworkTimeoutError(error: unknown) {
    if (!(error instanceof Error)) {
        return;
    }
    if (typeof error.cause !== "object" || error.cause === null) {
        return;
    }
    if (!("code" in error.cause)) {
        return;
    }
    if (error.cause.code !== "CONNECT_TIMEOUT") {
        return;
    }
    if (!("address" in error.cause)) {
        return;
    }
    if (typeof error.cause.address !== "string") {
        return;
    }
    if (!("port" in error.cause)) {
        return;
    }
    if (typeof error.cause.port !== "number") {
        return;
    }

    return {
        host: error.cause.address,
        code: error.cause.code,
        port: error.cause.port,
    };
}
