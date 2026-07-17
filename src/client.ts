/*
 * HiveClient core — Bearer-token client for the Hive LMS API.
 * Canonical source: Bluz `api-server/hive/client` (refresh flow, 401
 * refresh-retry, 500 exponential backoff, cookie-auth fetch), with madash's
 * `getOpenHelpsCount` folded in. Apps subclass this to add domain endpoints.
 */

import { HiveClientError } from "./errors.js";
import {
    Assignment,
    AssignmentRequest,
    Class,
    ClassTypeEnum,
    CourseUser,
    Exercise,
    ExerciseRequest,
    Help,
    HelpRequest,
    Lesson,
    LessonRequest,
    LessonRule,
    LessonRuleRequest,
    Module,
    ModuleRequest,
    Notification,
    NotificationRequest,
    PatchedMeRequest,
    Program,
    ProgramRequest,
    Queue,
    QueueRequest,
    RegisterCourseUser,
    RegisterCourseUserRequest,
    Seating,
    SeatingRequest,
    ScheduleColor,
    ScheduleColorRequest,
    ScheduleEvent,
    ScheduleEventRequest,
    ScheduleKiosk,
    ScheduleKioskRequest,
    SsoApplication,
    SsoApplicationRequest,
    SsoClientInfo,
    Subject,
    SubjectRequest,
    Tag,
    TagRequest,
} from "./types.js";

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

    async getMe(): Promise<CourseUser> {
        return await this._get<CourseUser>(this.buildUrl("/api/core/management/users/me/"));
    }

    async patchMe(data: PatchedMeRequest): Promise<CourseUser> {
        return await this._request<CourseUser>(
            this.buildUrl("/api/core/management/users/me/"),
            "PATCH",
            data,
        );
    }

    async checkIn(): Promise<Record<string, unknown>> {
        return await this._request<Record<string, unknown>>(
            this.buildUrl("/api/core/management/users/check_in/"),
            "PUT",
        );
    }

    async registerCourseUser(data: RegisterCourseUserRequest): Promise<RegisterCourseUser> {
        return await this._request<RegisterCourseUser>(
            this.buildUrl("/api/core/management/register/"),
            "POST",
            data,
        );
    }

    async getSsoClientInfo(): Promise<SsoClientInfo> {
        return await this._get<SsoClientInfo>(this.buildUrl("/api/core/sso/client-info/"));
    }

    async getServerTime(): Promise<string> {
        return await this._get<string>(this.buildUrl("/api/core/time/"));
    }

    async getAssignments(params?: Record<string, any>): Promise<Array<Assignment>> {
        const queryString = new URLSearchParams(params).toString();
        return await this._get<Array<Assignment>>(
            this.buildUrl(`/api/core/assignments/?${queryString}`),
        );
    }

    async getAssignment(id: number): Promise<Assignment> {
        return await this._get<Assignment>(this.buildUrl(`/api/core/assignments/${id}/`));
    }

    async createAssignment(data: AssignmentRequest): Promise<Assignment> {
        return await this._request<Assignment>(
            this.buildUrl("/api/core/assignments/"),
            "POST",
            data,
        );
    }

    async updateAssignment(id: number, data: AssignmentRequest): Promise<Assignment> {
        return await this._request<Assignment>(
            this.buildUrl(`/api/core/assignments/${id}/`),
            "PUT",
            data,
        );
    }

    async patchAssignment(id: number, data: Partial<AssignmentRequest>): Promise<Assignment> {
        return await this._request<Assignment>(
            this.buildUrl(`/api/core/assignments/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteAssignment(id: number): Promise<void> {
        return await this._request<void>(this.buildUrl(`/api/core/assignments/${id}/`), "DELETE");
    }

    async getExercises(params?: Record<string, any>): Promise<Array<Exercise>> {
        const queryString = new URLSearchParams(params).toString();
        return await this._get<Array<Exercise>>(
            this.buildUrl(`/api/core/course/exercises/?${queryString}`),
        );
    }

    async getExercise(id: number): Promise<Exercise> {
        return await this._get<Exercise>(this.buildUrl(`/api/core/course/exercises/${id}/`));
    }

    async createExercise(data: ExerciseRequest): Promise<Exercise> {
        return await this._request<Exercise>(
            this.buildUrl("/api/core/course/exercises/"),
            "POST",
            data,
        );
    }

    async updateExercise(id: number, data: ExerciseRequest): Promise<Exercise> {
        return await this._request<Exercise>(
            this.buildUrl(`/api/core/course/exercises/${id}/`),
            "PUT",
            data,
        );
    }

    async patchExercise(id: number, data: Partial<ExerciseRequest>): Promise<Exercise> {
        return await this._request<Exercise>(
            this.buildUrl(`/api/core/course/exercises/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteExercise(id: number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/course/exercises/${id}/`),
            "DELETE",
        );
    }

    async getPrograms(): Promise<Array<Program>> {
        return await this._get<Array<Program>>(this.buildUrl("/api/core/course/programs/"));
    }

    async getProgram(id: number): Promise<Program> {
        return await this._get<Program>(this.buildUrl(`/api/core/course/programs/${id}/`));
    }

    async createProgram(data: ProgramRequest): Promise<Program> {
        return await this._request<Program>(
            this.buildUrl("/api/core/course/programs/"),
            "POST",
            data,
        );
    }

    async updateProgram(id: number, data: ProgramRequest): Promise<Program> {
        return await this._request<Program>(
            this.buildUrl(`/api/core/course/programs/${id}/`),
            "PUT",
            data,
        );
    }

    async patchProgram(id: number, data: Partial<ProgramRequest>): Promise<Program> {
        return await this._request<Program>(
            this.buildUrl(`/api/core/course/programs/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteProgram(id: number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/course/programs/${id}/`),
            "DELETE",
        );
    }

    async getSubjects(): Promise<Array<Subject>> {
        return await this._get<Array<Subject>>(this.buildUrl("/api/core/course/subjects/"));
    }

    async getSubject(id: number): Promise<Subject> {
        return await this._get<Subject>(this.buildUrl(`/api/core/course/subjects/${id}/`));
    }

    async createSubject(data: SubjectRequest): Promise<Subject> {
        return await this._request<Subject>(
            this.buildUrl("/api/core/course/subjects/"),
            "POST",
            data,
        );
    }

    async updateSubject(id: number, data: SubjectRequest): Promise<Subject> {
        return await this._request<Subject>(
            this.buildUrl(`/api/core/course/subjects/${id}/`),
            "PUT",
            data,
        );
    }

    async patchSubject(id: number, data: Partial<SubjectRequest>): Promise<Subject> {
        return await this._request<Subject>(
            this.buildUrl(`/api/core/course/subjects/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteSubject(id: number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/course/subjects/${id}/`),
            "DELETE",
        );
    }

    async getModules(): Promise<Array<Module>> {
        return await this._get<Array<Module>>(this.buildUrl("/api/core/course/modules/"));
    }

    async getModule(id: number): Promise<Module> {
        return await this._get<Module>(this.buildUrl(`/api/core/course/modules/${id}/`));
    }

    async createModule(data: ModuleRequest): Promise<Module> {
        return await this._request<Module>(
            this.buildUrl("/api/core/course/modules/"),
            "POST",
            data,
        );
    }

    async updateModule(id: number, data: ModuleRequest): Promise<Module> {
        return await this._request<Module>(
            this.buildUrl(`/api/core/course/modules/${id}/`),
            "PUT",
            data,
        );
    }

    async patchModule(id: number, data: Partial<ModuleRequest>): Promise<Module> {
        return await this._request<Module>(
            this.buildUrl(`/api/core/course/modules/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteModule(id: number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/course/modules/${id}/`),
            "DELETE",
        );
    }

    async getHelps(params?: Record<string, any>): Promise<Array<Help>> {
        const queryString = new URLSearchParams(params).toString();
        return await this._get<Array<Help>>(this.buildUrl(`/api/core/help/?${queryString}`));
    }

    async getHelp(id: number): Promise<Help> {
        return await this._get<Help>(this.buildUrl(`/api/core/help/${id}/`));
    }

    async createHelp(data: HelpRequest): Promise<Help> {
        return await this._request<Help>(this.buildUrl("/api/core/help/"), "POST", data);
    }

    async updateHelp(id: number, data: HelpRequest): Promise<Help> {
        return await this._request<Help>(this.buildUrl(`/api/core/help/${id}/`), "PUT", data);
    }

    async patchHelp(id: number, data: Partial<HelpRequest>): Promise<Help> {
        return await this._request<Help>(this.buildUrl(`/api/core/help/${id}/`), "PATCH", data);
    }

    async deleteHelp(id: number): Promise<void> {
        return await this._request<void>(this.buildUrl(`/api/core/help/${id}/`), "DELETE");
    }

    async getNotifications(params?: Record<string, any>): Promise<Array<Notification>> {
        const queryString = new URLSearchParams(params).toString();
        return await this._get<Array<Notification>>(
            this.buildUrl(`/api/core/notification/?${queryString}`),
        );
    }

    async getNotification(id: number): Promise<Notification> {
        return await this._get<Notification>(this.buildUrl(`/api/core/notification/${id}/`));
    }

    async createNotification(data: NotificationRequest): Promise<Notification> {
        return await this._request<Notification>(
            this.buildUrl("/api/core/notification/"),
            "POST",
            data,
        );
    }

    async updateNotification(id: number, data: NotificationRequest): Promise<Notification> {
        return await this._request<Notification>(
            this.buildUrl(`/api/core/notification/${id}/`),
            "PUT",
            data,
        );
    }

    async patchNotification(
        id: number,
        data: Partial<NotificationRequest>,
    ): Promise<Notification> {
        return await this._request<Notification>(
            this.buildUrl(`/api/core/notification/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteNotification(id: number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/notification/${id}/`),
            "DELETE",
        );
    }

    async getQueues(): Promise<Array<Queue>> {
        return await this._get<Array<Queue>>(this.buildUrl("/api/core/queues/"));
    }

    async getQueue(id: number): Promise<Queue> {
        return await this._get<Queue>(this.buildUrl(`/api/core/queues/${id}/`));
    }

    async createQueue(data: QueueRequest): Promise<Queue> {
        return await this._request<Queue>(this.buildUrl("/api/core/queues/"), "POST", data);
    }

    async updateQueue(id: number, data: QueueRequest): Promise<Queue> {
        return await this._request<Queue>(this.buildUrl(`/api/core/queues/${id}/`), "PUT", data);
    }

    async patchQueue(id: number, data: Partial<QueueRequest>): Promise<Queue> {
        return await this._request<Queue>(
            this.buildUrl(`/api/core/queues/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteQueue(id: number): Promise<void> {
        return await this._request<void>(this.buildUrl(`/api/core/queues/${id}/`), "DELETE");
    }

    async getScheduleColors(): Promise<Array<ScheduleColor>> {
        return await this._get<Array<ScheduleColor>>(this.buildUrl("/api/core/schedule/colors/"));
    }

    async getScheduleColor(id: number): Promise<ScheduleColor> {
        return await this._get<ScheduleColor>(this.buildUrl(`/api/core/schedule/colors/${id}/`));
    }

    async createScheduleColor(data: ScheduleColorRequest): Promise<ScheduleColor> {
        return await this._request<ScheduleColor>(
            this.buildUrl("/api/core/schedule/colors/"),
            "POST",
            data,
        );
    }

    async updateScheduleColor(id: number, data: ScheduleColorRequest): Promise<ScheduleColor> {
        return await this._request<ScheduleColor>(
            this.buildUrl(`/api/core/schedule/colors/${id}/`),
            "PUT",
            data,
        );
    }

    async patchScheduleColor(
        id: number,
        data: Partial<ScheduleColorRequest>,
    ): Promise<ScheduleColor> {
        return await this._request<ScheduleColor>(
            this.buildUrl(`/api/core/schedule/colors/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteScheduleColor(id: number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/schedule/colors/${id}/`),
            "DELETE",
        );
    }

    async getScheduleEvents(params?: Record<string, any>): Promise<Array<ScheduleEvent>> {
        const queryString = new URLSearchParams(params).toString();
        return await this._get<Array<ScheduleEvent>>(
            this.buildUrl(`/api/core/schedule/events/?${queryString}`),
        );
    }

    async getScheduleEvent(id: number): Promise<ScheduleEvent> {
        return await this._get<ScheduleEvent>(this.buildUrl(`/api/core/schedule/events/${id}/`));
    }

    async createScheduleEvent(data: ScheduleEventRequest): Promise<ScheduleEvent> {
        return await this._request<ScheduleEvent>(
            this.buildUrl("/api/core/schedule/events/"),
            "POST",
            data,
        );
    }

    async updateScheduleEvent(id: number, data: ScheduleEventRequest): Promise<ScheduleEvent> {
        return await this._request<ScheduleEvent>(
            this.buildUrl(`/api/core/schedule/events/${id}/`),
            "PUT",
            data,
        );
    }

    async patchScheduleEvent(
        id: number,
        data: Partial<ScheduleEventRequest>,
    ): Promise<ScheduleEvent> {
        return await this._request<ScheduleEvent>(
            this.buildUrl(`/api/core/schedule/events/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteScheduleEvent(id: number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/schedule/events/${id}/`),
            "DELETE",
        );
    }

    async getScheduleKiosks(): Promise<Array<ScheduleKiosk>> {
        return await this._get<Array<ScheduleKiosk>>(this.buildUrl("/api/core/schedule/kiosk/"));
    }

    async getScheduleKiosk(id: number): Promise<ScheduleKiosk> {
        return await this._get<ScheduleKiosk>(this.buildUrl(`/api/core/schedule/kiosk/${id}/`));
    }

    async createScheduleKiosk(data: ScheduleKioskRequest): Promise<ScheduleKiosk> {
        return await this._request<ScheduleKiosk>(
            this.buildUrl("/api/core/schedule/kiosk/"),
            "POST",
            data,
        );
    }

    async updateScheduleKiosk(id: number, data: ScheduleKioskRequest): Promise<ScheduleKiosk> {
        return await this._request<ScheduleKiosk>(
            this.buildUrl(`/api/core/schedule/kiosk/${id}/`),
            "PUT",
            data,
        );
    }

    async patchScheduleKiosk(
        id: number,
        data: Partial<ScheduleKioskRequest>,
    ): Promise<ScheduleKiosk> {
        return await this._request<ScheduleKiosk>(
            this.buildUrl(`/api/core/schedule/kiosk/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteScheduleKiosk(id: number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/schedule/kiosk/${id}/`),
            "DELETE",
        );
    }

    async getLessons(params?: Record<string, any>): Promise<Array<Lesson>> {
        const queryString = new URLSearchParams(params).toString();
        return await this._get<Array<Lesson>>(
            this.buildUrl(`/api/core/schedule/lessons/?${queryString}`),
        );
    }

    async getLesson(id: number): Promise<Lesson> {
        return await this._get<Lesson>(this.buildUrl(`/api/core/schedule/lessons/${id}/`));
    }

    async createLesson(data: LessonRequest): Promise<Lesson> {
        return await this._request<Lesson>(
            this.buildUrl("/api/core/schedule/lessons/"),
            "POST",
            data,
        );
    }

    async updateLesson(id: number, data: LessonRequest): Promise<Lesson> {
        return await this._request<Lesson>(
            this.buildUrl(`/api/core/schedule/lessons/${id}/`),
            "PUT",
            data,
        );
    }

    async patchLesson(id: number, data: Partial<LessonRequest>): Promise<Lesson> {
        return await this._request<Lesson>(
            this.buildUrl(`/api/core/schedule/lessons/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteLesson(id: number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/schedule/lessons/${id}/`),
            "DELETE",
        );
    }

    async setLessonForClass(classId: number, lessonId: null | number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/management/classes/${classId}/lesson/`),
            "POST",
            { lesson: lessonId },
        );
    }

    async getLessonRules(parentId: number): Promise<Array<LessonRule>> {
        return await this._request<Array<LessonRule>>(
            this.buildUrl(`/api/core/schedule/lessons/${parentId}/rules/`),
            "GET",
        );
    }

    async getLessonRule(parentId: number, id: number): Promise<LessonRule> {
        return await this._request<LessonRule>(
            this.buildUrl(`/api/core/schedule/lessons/${parentId}/rules/${id}/`),
            "GET",
        );
    }

    async createLessonRule(parentId: number, data: LessonRuleRequest): Promise<LessonRule> {
        return await this._request<LessonRule>(
            this.buildUrl(`/api/core/schedule/lessons/${parentId}/rules/`),
            "POST",
            data,
        );
    }

    async updateLessonRule(
        parentId: number,
        id: number,
        data: LessonRuleRequest,
    ): Promise<LessonRule> {
        return await this._request<LessonRule>(
            this.buildUrl(`/api/core/schedule/lessons/${parentId}/rules/${id}/`),
            "PUT",
            data,
        );
    }

    async patchLessonRule(
        parentId: number,
        id: number,
        data: Partial<LessonRuleRequest>,
    ): Promise<LessonRule> {
        return await this._request<LessonRule>(
            this.buildUrl(`/api/core/schedule/lessons/${parentId}/rules/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteLessonRule(parentId: number, id: number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/schedule/lessons/${parentId}/rules/${id}/`),
            "DELETE",
        );
    }

    async getSsoApplications(): Promise<Array<SsoApplication>> {
        return await this._get<Array<SsoApplication>>(this.buildUrl("/api/core/sso/applications/"));
    }

    async getSsoApplication(id: number): Promise<SsoApplication> {
        return await this._get<SsoApplication>(
            this.buildUrl(`/api/core/sso/applications/${id}/`),
        );
    }

    async createSsoApplication(data: SsoApplicationRequest): Promise<SsoApplication> {
        return await this._request<SsoApplication>(
            this.buildUrl("/api/core/sso/applications/"),
            "POST",
            data,
        );
    }

    async updateSsoApplication(id: number, data: SsoApplicationRequest): Promise<SsoApplication> {
        return await this._request<SsoApplication>(
            this.buildUrl(`/api/core/sso/applications/${id}/`),
            "PUT",
            data,
        );
    }

    async patchSsoApplication(
        id: number,
        data: Partial<SsoApplicationRequest>,
    ): Promise<SsoApplication> {
        return await this._request<SsoApplication>(
            this.buildUrl(`/api/core/sso/applications/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteSsoApplication(id: number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/sso/applications/${id}/`),
            "DELETE",
        );
    }

    async getTags(): Promise<Array<Tag>> {
        return await this._get<Array<Tag>>(this.buildUrl("/api/core/tags/"));
    }

    async getTag(id: number): Promise<Tag> {
        return await this._get<Tag>(this.buildUrl(`/api/core/tags/${id}/`));
    }

    async createTag(data: TagRequest): Promise<Tag> {
        return await this._request<Tag>(this.buildUrl("/api/core/tags/"), "POST", data);
    }

    async updateTag(id: number, data: TagRequest): Promise<Tag> {
        return await this._request<Tag>(this.buildUrl(`/api/core/tags/${id}/`), "PUT", data);
    }

    async patchTag(id: number, data: Partial<TagRequest>): Promise<Tag> {
        return await this._request<Tag>(this.buildUrl(`/api/core/tags/${id}/`), "PATCH", data);
    }

    async deleteTag(id: number): Promise<void> {
        return await this._request<void>(this.buildUrl(`/api/core/tags/${id}/`), "DELETE");
    }

    async getSeatings(): Promise<Array<Seating>> {
        return await this._get<Array<Seating>>(this.buildUrl("/api/core/management/seating/"));
    }

    async getSeating(id: number): Promise<Seating> {
        return await this._get<Seating>(this.buildUrl(`/api/core/management/seating/${id}/`));
    }

    async createSeating(data: SeatingRequest): Promise<Seating> {
        return await this._request<Seating>(
            this.buildUrl("/api/core/management/seating/"),
            "POST",
            data,
        );
    }

    async updateSeating(id: number, data: SeatingRequest): Promise<Seating> {
        return await this._request<Seating>(
            this.buildUrl(`/api/core/management/seating/${id}/`),
            "PUT",
            data,
        );
    }

    async patchSeating(id: number, data: Partial<SeatingRequest>): Promise<Seating> {
        return await this._request<Seating>(
            this.buildUrl(`/api/core/management/seating/${id}/`),
            "PATCH",
            data,
        );
    }

    async deleteSeating(id: number): Promise<void> {
        return await this._request<void>(
            this.buildUrl(`/api/core/management/seating/${id}/`),
            "DELETE",
        );
    }
}
