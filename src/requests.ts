/*
 * Hive LMS request/response payload types, kept separate from the entity
 * types in ./types.ts so `*Request` shapes don't share scope with the real
 * entities they mutate.
 */

import {
    AssignmentResponseTypeEnum,
    AssignmentStatusEnum,
    EventTypeEnum,
    ExercisePreviewTypes,
    GenderEnum,
    HelpResponseTypeEnum,
    HelpTypeEnum,
    PatbasEnum,
    StatusEnum,
    VisibilityEnum,
} from "./types.js";

export type LessonRequest = {
    name: string;
    module: number;
    description?: string;
};

export type LessonRuleRequest = {
    parent_rule?: null | number;
    student_groups?: Array<number>;
    queue?: null | number;
};

export type AssignmentResponseContentRequest = {
    content: string;
    field: number;
};

export type AssignmentResponseRequest = {
    contents: Array<AssignmentResponseContentRequest>;
    /** @maxLength 255 */
    file_name?: string;
    dear_student?: boolean;
    hide_checker_name?: boolean;
    segel_only?: boolean;
    response_type: AssignmentResponseTypeEnum;
};

export type HelpResponseRequest = {
    contents?: string;
    /** @maxLength 255 */
    file_name?: string;
    dear_student?: boolean;
    hide_checker_name?: boolean;
    segel_only?: boolean;
    response_type: HelpResponseTypeEnum;
};

export type QueueRequest = {
    /** @maxLength 100 */
    name: string;
    /** @maxLength 150 */
    description?: string;
    module?: null | number;
    user?: null | number;
};

export type AssignmentRequest = {
    assignment_status: AssignmentStatusEnum;
    student_assignment_status?: AssignmentStatusEnum;
    description?: string;
    submission_count?: number;
    total_check_count?: number;
    manual_check_count?: number;
    flagged?: boolean;
    timer?: null | string;
};

export type ExerciseRequest = {
    /** @maxLength 100 */
    name: string;
    parent_module: number;
    download?: boolean;
    preview?: ExercisePreviewTypes;
    patbas_preview?: ExercisePreviewTypes;
    patbas_download?: boolean;
    is_lecture?: boolean;
    /** @maxLength 100 */
    style?: string;
    /** @maxLength 100 */
    order: string;
    tags?: Array<string>;
    patbas?: PatbasEnum;
    /** @maxLength 20 */
    autocheck_tag?: string;
    autodone?: boolean;
    expected_duration?: null | string;
    segel_brief?: string;
};

export type ProgramRequest = {
    /** @maxLength 100 */
    name: string;
    checker: number;
    default_class?: null | number;
    auto_toilet?: boolean;
    hanich_raise_hand?: boolean;
    auto_schedule?: boolean;
    auto_room?: boolean;
    hanich_day_only?: boolean;
    hanich_work_name?: boolean;
    auto_toilet_count?: number;
    hanich_classes_only?: boolean;
    hanich_schedule?: boolean;
};

export type SubjectRequest = {
    /** @maxLength 100 */
    symbol: string;
    parent_program: number;
    /** @maxLength 7 */
    color: string;
    /** @maxLength 100 */
    name: string;
    segel_brief?: string;
};

export type ModuleRequest = {
    /** @maxLength 100 */
    name: string;
    parent_subject: number;
    /** @maxLength 100 */
    order: string;
    segel_brief?: string;
};

export type HelpRequest = {
    user: number;
    /** @maxLength 30 */
    title?: string;
    help_type: HelpTypeEnum;
    exercise_id: null | number;
    visibility?: VisibilityEnum;
};

export type NotificationRequest = {
    help?: null | number;
    assignment?: null | number;
    comment?: string;
    was_read?: boolean;
    user: number;
};

export type ScheduleColorRequest = {
    /** @maxLength 20 */
    name: string;
    /** @maxLength 7 */
    color: string;
};

export type ScheduleEventRequest = {
    start: string;
    end: string;
    type: EventTypeEnum;
    /** @maxLength 100 */
    location?: string;
};

export type ScheduleKioskRequest = {
    start: string;
    end: string;
    type: EventTypeEnum;
    /** @maxLength 100 */
    location?: string;
};

export type SsoApplicationRequest = {
    /** @maxLength 255 */
    name?: string;
    /** Allowed URIs list, space separated */
    redirect_uris?: string;
};

export type TagRequest = {
    /** @maxLength 100 */
    name: string;
    /** @maxLength 7 */
    color: string;
};

export type SeatingRequest = {
    /** @maxLength 255 */
    hostname?: null | string;
    hanich?: null | number;
    classroom: number;
    x: number;
    y: number;
};

export type RegisterCourseUserRequest = {
    /** @maxLength 150 */
    first_name: string;
    /** @maxLength 150 */
    last_name: string;
    /** @maxLength 150 */
    username: string;
    gender: GenderEnum;
    /** @maxLength 128 */
    password: string;
    /** @maxLength 256 */
    secret: string;
};

export type PatchedMeRequest = {
    status?: StatusEnum;
    current_assignment?: null | number;
    confirmed?: boolean;
    /** @maxLength 128 */
    password?: string;
    /** @maxLength 128 */
    current_password?: string;
    /** @maxLength 255 */
    hostname?: string;
};
