/*
 * Service-account authentication for background work.
 *
 * The session-based flows (SSO / next-auth) only exist while a human is
 * logged in. Anything that has to talk to Hive on a schedule — Bluz opening a
 * lesson's queue the minute an event goes live, for instance — needs its own
 * identity. Hive issues one through the plain JWT endpoint, so a dedicated
 * Hive user with the right clearance is all that's required.
 */

import { HiveClient } from "./client.js";
import { HiveClientError } from "./errors.js";

export type HiveServiceCredentials = {
    username: string;
    password: string;
    /** Defaults to `NEXT_PUBLIC_HIVE_URL`, matching HiveClient's own default. */
    hiveBaseUrl?: string;
    /**
     * Reuse a cached client for this account instead of logging in again.
     * On by default: a service account performs many small calls, and logging
     * in per call would put a token request in front of each one. The cached
     * client refreshes its own access token on a 401, so it stays usable well
     * past the access token's lifetime. Pass `false` to force a fresh login.
     */
    cache?: boolean;
};

/**
 * How long a cached client is reused before a fresh login.
 *
 * Pinned to Hive's own access-token lifetime — `SIMPLE_JWT
 * .ACCESS_TOKEN_LIFETIME`, which Hive reads from
 * `HIVE_ACCESS_TOKEN_LIFETIME_MINUTES` (60 by default) — less a minute of
 * margin, so a cached client never hands out a token that expires mid-flight.
 * The client's own 401 refresh remains the backstop.
 */
function cacheTtlMs(): number {
    const minutes =
        Number(process.env.HIVE_ACCESS_TOKEN_LIFETIME_MINUTES) || 60;
    return Math.max(minutes * 60 * 1000 - 60_000, 60_000);
}

const clientCache = new Map<string, { client: HiveClient; obtainedAt: number }>();

function cacheKey(credentials: HiveServiceCredentials): string {
    return `${credentials.hiveBaseUrl ?? ""}|${credentials.username}`;
}

/**
 * Drops cached service clients — after a password rotation, or between tests.
 * @param credentials Clear just this account's entry; omit to clear all.
 */
export function resetHiveServiceClientCache(
    credentials?: HiveServiceCredentials,
): void {
    if (credentials) clientCache.delete(cacheKey(credentials));
    else clientCache.clear();
}

type HiveClientConstructor<C extends HiveClient> = new (
    accessToken: string,
    refreshToken?: string,
    hiveBaseUrl?: string,
) => C;

/**
 * Exchanges service-account credentials for a Hive access/refresh token pair.
 * @param credentials The service account's username, password and Hive URL.
 * @returns The freshly issued token pair.
 * @throws HiveClientError when Hive rejects the credentials or is unreachable.
 */
export async function obtainHiveServiceTokens(
    credentials: HiveServiceCredentials,
): Promise<{ access: string; refresh?: string }> {
    const baseUrl = (
        credentials.hiveBaseUrl ??
        process.env.NEXT_PUBLIC_HIVE_URL ??
        ""
    ).replace(/\/$/, "");

    const response = await fetch(`${baseUrl}/api/core/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: credentials.username,
            password: credentials.password,
        }),
    });

    if (!response.ok) {
        throw new HiveClientError(
            `התחברות משתמש השירות להייב נכשלה (${response.status})`,
        );
    }

    const data = await response.json();
    if (!data?.access) {
        throw new HiveClientError("הייב לא החזיר טוקן למשתמש השירות");
    }
    return { access: data.access, refresh: data.refresh };
}

/**
 * Builds a Hive client authenticated as a service account.
 *
 * Cached per (Hive URL, username) by default, so repeated calls hand back the
 * same client instead of asking Hive for a token every time; the client
 * refreshes itself when its access token expires. Pass `cache: false` to force
 * a fresh login.
 *
 * @param credentials The service account's username, password and Hive URL.
 * @param clientCtor Client subclass to instantiate (defaults to HiveClient).
 * @returns A client acting as the service account.
 * @example
 * ```typescript
 * const hive = await createHiveServiceClient({ username, password });
 * ```
 */
export async function createHiveServiceClient<C extends HiveClient = HiveClient>(
    credentials: HiveServiceCredentials,
    clientCtor: HiveClientConstructor<C> = HiveClient as HiveClientConstructor<C>,
): Promise<C> {
    const useCache = credentials.cache !== false;
    const key = cacheKey(credentials);

    if (useCache) {
        const cached = clientCache.get(key);
        if (cached && Date.now() - cached.obtainedAt < cacheTtlMs()) {
            return cached.client as C;
        }
    }

    const { access, refresh } = await obtainHiveServiceTokens(credentials);
    const client = new clientCtor(access, refresh, credentials.hiveBaseUrl);

    if (useCache) clientCache.set(key, { client, obtainedAt: Date.now() });
    return client;
}
