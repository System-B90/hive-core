/*
 * Shared setup for integration tests: they run against a real Hive instance
 * rather than a mock. In CI, System-B90/.github's `setup-hive` composite
 * action boots one at https://hive.org (self-signed cert — tests must run
 * with NODE_TLS_REJECT_UNAUTHORIZED=0, same as the other consumer repos'
 * E2E workflows) and seeds the "admin"/"Password1" superuser via
 * `manage.py createsuperuser`. Locally, these env vars default to that same
 * combination; if nothing answers at HIVE_TEST_URL the whole suite skips
 * instead of failing, so `npm test` stays green without a Hive stack.
 */

export const HIVE_TEST_URL = process.env.HIVE_TEST_URL ?? "https://hive.org";
const HIVE_TEST_USERNAME = process.env.HIVE_TEST_USERNAME ?? "admin";
const HIVE_TEST_PASSWORD = process.env.HIVE_TEST_PASSWORD ?? "Password1";

export type TokenPair = { access: string; refresh: string };

/** Logs in with the Resource Owner Password flow (`POST /api/core/token/`). */
export async function login(): Promise<TokenPair> {
    const response = await fetch(`${HIVE_TEST_URL}/api/core/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: HIVE_TEST_USERNAME,
            password: HIVE_TEST_PASSWORD,
        }),
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
        throw new Error(
            `Hive login failed: HTTP ${response.status} ${await response.text()}`,
        );
    }
    return (await response.json()) as TokenPair;
}
