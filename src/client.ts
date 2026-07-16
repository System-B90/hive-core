/*
 * HiveClient core — Bearer-token client for the Hive LMS API.
 * Canonical source: Bluz `api-server/hive/client` (refresh flow, 401
 * refresh-retry, 500 exponential backoff, cookie-auth fetch), with madash's
 * `getOpenHelpsCount` folded in. Apps subclass this to add domain endpoints.
 */

import { HiveClientError } from "./errors.js";
import { Class, ClassTypeEnum, CourseUser } from "./types.js";

type TimeoutError = {
    name: "TypeError";
    cause: {
        name: string;
        [key: string]: unknown;
    };
} & Error;

export function isTimeoutError(e: unknown): e is TimeoutError {
    return (
        e instanceof Error &&
        e.name === "TypeError" &&
        "cause" in e &&
        typeof e.cause === "object" &&
        e.cause !== null &&
        "name" in e.cause &&
        typeof (e.cause as Record<string, unknown>).name === "string"
    );
}

export type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export class HiveClient {
    protected accessToken: string;
    protected refreshTokenValue?: string;
    protected hiveBaseUrl: string;

    constructor(
        accessToken: string,
        refreshToken?: string,
        hiveBaseUrl?: string,
    ) {
        this.accessToken = accessToken;
        this.refreshTokenValue = refreshToken;
        // The Hive instance changes every iteration; callers can target a
        // specific instance, falling back to the default env URL.
        this.hiveBaseUrl =
            hiveBaseUrl ?? process.env.NEXT_PUBLIC_HIVE_URL ?? "";
    }

    protected buildUrl(path: string): string {
        return `${this.hiveBaseUrl.replace(/\/$/, "")}${path}`;
    }

    protected async refreshAccessToken(): Promise<void> {
        if (!this.refreshTokenValue) {
            throw new HiveClientError("אין טוקן רפרש זמין, נדרשת התחברות מחדש");
        }

        const response = await fetch(
            this.buildUrl("/api/core/token/refresh/"),
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    refresh: this.refreshTokenValue,
                }),
            },
        );

        if (!response.ok) {
            throw new HiveClientError("עדכון הטוקן נכשל, נדרשת התחברות מחדש");
        }

        const data = await response.json();
        this.accessToken = data.access;

        if (data.refresh) {
            this.refreshTokenValue = data.refresh;
        }
    }

    protected async _request<T>(
        url: string,
        method: HttpMethod,
        body?: unknown,
        isRetry = false,
        retryCount = 0,
    ): Promise<T> {
        const response = await fetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                "Content-Type": "application/json",
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (response.status === 401) {
            if (!isRetry && this.refreshTokenValue) {
                await this.refreshAccessToken();
                return await this._request<T>(url, method, body, true, 0);
            }
            throw new HiveClientError("הטוקן אינו תקף, נדרשת התחברות מחדש");
        }

        if (response.status === 500) {
            if (retryCount >= 3) {
                throw new HiveClientError(
                    `שגיאה בשרת הייב לאחר ${retryCount} ניסיונות: ${response.statusText}`,
                );
            }
            await new Promise((resolve) =>
                setTimeout(resolve, 200 * Math.pow(2, retryCount)),
            );
            return await this._request<T>(url, method, body, isRetry, retryCount + 1);
        }

        if (!response.ok) {
            throw new HiveClientError(
                `פעולה מול הייב נכשלה: ${response.statusText}`,
            );
        }

        if (response.status === 204) {
            return undefined as T;
        }

        const text = await response.text();
        return text ? JSON.parse(text) : (undefined as T);
    }

    protected async _get<T>(
        url: string,
        isRetry = false,
        retryCount = 0,
    ): Promise<T> {
        return await this._request<T>(url, "GET", undefined, isRetry, retryCount);
    }

    /**
     * Hive-hosted services such as Prometheus expect `Cookie: token=<access_token>`
     * instead of (or in addition to) Bearer auth.
     */
    async fetchWithTokenCookie(
        url: string,
        init: RequestInit = {},
        isRetry = false,
    ): Promise<Response> {
        const headers = new Headers(init.headers);
        headers.set("Cookie", `token=${this.accessToken}`);

        const response = await fetch(url, {
            ...init,
            headers,
        });

        if (response.status === 401) {
            if (!isRetry && this.refreshTokenValue) {
                await this.refreshAccessToken();
                return await this.fetchWithTokenCookie(url, init, true);
            }
        }

        return response;
    }

    async getUsers(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- URLSearchParams coerces values; callers pass enums/arrays (e.g. clearance__in)
        params?: Record<string, any>,
    ): Promise<Array<CourseUser>> {
        const queryString = new URLSearchParams(params).toString();
        return await this._get<Array<CourseUser>>(
            this.buildUrl(`/api/core/management/users/?${queryString}`),
        );
    }

    /** All Hive classes; pass a `type` to filter (e.g. Student Group / Room). */
    async getClasses(type?: ClassTypeEnum): Promise<Array<Class>> {
        const query = type
            ? `?${new URLSearchParams({ type }).toString()}`
            : "";
        return await this._get<Array<Class>>(
            this.buildUrl(`/api/core/management/classes/${query}`),
        );
    }

    /** Open help tickets (Hive `/api/core/help/` list); returns total `count` from the JSON body. */
    async getOpenHelpsCount(): Promise<number> {
        const params = new URLSearchParams({
            limit: "1",
            help_status__in: "Open",
        });
        const data = await this._get<{ count?: unknown }>(
            this.buildUrl(`/api/core/help/?${params.toString()}`),
        );
        const count = data.count;
        if (typeof count !== "number" || !Number.isFinite(count)) {
            throw new HiveClientError("תגובת הייב לעזרות פתוחות לא תקינה");
        }
        return count;
    }
}
