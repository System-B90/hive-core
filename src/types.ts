/*
 * Hive LMS entity types shared by all System-B90 consumers.
 *
 * Note: This file does not update automatically.
 * DRF-Spectacular outputs enum values in the description: https://github.com/tfranzel/drf-spectacular/pull/952
 * But Orval does not seem to support this for now.
 */

export enum QueueType {
    User = 1,
    Program,
    Subject,
    Module,
}

export enum Clearance {
    Logged_Out = 0,
    Hanich = 1,
    Checker = 2,
    Segel = 3,
    Admin = 5,
}

export const clearanceName = (clearance: Clearance) => {
    switch (clearance) {
    case Clearance.Hanich:
        return "Hanich" as const;
    case Clearance.Checker:
        return "Checker" as const;
    case Clearance.Segel:
        return "Segel" as const;
    case Clearance.Admin:
        return "Admin" as const;
    }
};

export enum ClassTypeEnum {
    Room = "Room",
    Student_Group = "Student Group",
}

/**
 * * `Male` - Male
 * `Female` - Female
 * `NonBinary` - Nonbinary
 */
export type GenderEnum = (typeof GenderEnum)[keyof typeof GenderEnum];

export const GenderEnum = {
    Male: "Male",
    Female: "Female",
    NonBinary: "NonBinary",
} as const;

/**
 * * `Present` - Present
 * `Raised Hand` - Raisedhand
 * `Toilet Request` - Toiletrequest
 * `Toilet` - Toilet
 * `Personal Talk` - Personaltalk
 * `Work Talk` - Worktalk
 * `Medical` - Medical
 * `Prayer` - Prayer
 * `Room` - Room
 * `Home` - Home
 */
export type StatusEnum = (typeof StatusEnum)[keyof typeof StatusEnum];

export const StatusEnum = {
    Present: "Present",
    Raised_Hand: "Raised Hand",
    Toilet_Request: "Toilet Request",
    Toilet: "Toilet",
    Personal_Talk: "Personal Talk",
    Work_Talk: "Work Talk",
    Medical: "Medical",
    Prayer: "Prayer",
    Room: "Room",
    Home: "Home",
} as const;

export type CourseUser = {
    avatar_filename?: string;
    checkers_brief?: string;
    classes?: Array<number>;
    /**
     * @minimum -2147483648
     * @maximum 2147483647
     */
    clearance: Clearance;
    confirmed?: boolean;
    /** @nullable */
    readonly current_assignment: null | number;
    readonly current_assignment_options: ReadonlyArray<number>;
    disable_queue?: boolean;
    disable_user_queue?: boolean;
    readonly display_name: string;
    /** @maxLength 150 */
    first_name?: string;
    gender: GenderEnum;
    /** @maxLength 255 */
    hostname?: string;
    readonly id: number;
    /** @maxLength 150 */
    last_name?: string;
    mentees: Array<number>;
    /** @nullable */
    mentor?: null | number;
    /**
     * @minimum -2147483648
     * @maximum 2147483647
     * @nullable
     */
    number?: null | number;
    /** @nullable */
    override_queue?: null | number;
    /** @nullable */
    program?: null | number;
    /** @nullable */
    queue?: null | number;
    status: StatusEnum;
    readonly status_date: string;
    teacher?: boolean;
    /** @nullable */
    user_queue?: null | number;
    /**
     * Required. 150 characters or fewer. Letters, digits and @/./+/-/_ only.
     * @maxLength 150
     * @pattern ^[\w.@+-]+$
     */
    username: string;
};

export type Class = {
    /**
     * @maxLength 100
     * @nullable
     */
    description?: null | string;
    readonly display_name: string;
    /** @maxLength 254 */
    email?: string;
    readonly id: number;
    /** @maxLength 100 */
    name: string;
    program: number;
    readonly program__name: string;
    type?: ClassTypeEnum;
    users: Array<number>;
};

/** A Hive class of type Room (madash's `Room` narrowing). */
export type RoomClass = Class & {
    type: ClassTypeEnum.Room;
};

export type Queue = {
    readonly id: number;
    name: string;
    description?: string;
    module?: null | number;
    user?: null | number;
    readonly user_id: null | number;
    readonly user_name: null | string;
    readonly subject_id: null | number;
    readonly subject_name: null | string;
    readonly subject_color: null | string;
    readonly subject_symbol: null | string;
    readonly module_id: null | number;
    readonly module_name: null | string;
    readonly module_order: null | string;
    readonly program_id: number;
    readonly program_name: string;
};

export type Lesson = {
    readonly id: number;
    name: string;
    module: number;
    readonly module_order: string;
    readonly module_name: string;
    readonly subject_symbol: string;
    readonly subject_name: string;
    readonly program_name: string;
    description?: string;
};

export type LessonRequest = {
    name: string;
    module: number;
    description?: string;
};

export type LessonRule = {
    readonly id: number;
    parent_rule: null | number;
    student_groups: Array<number>;
    queue: null | number;
    readonly queue_data: null | Queue;
    readonly student_groups_data: Array<Class> | null;
};

export type LessonRuleRequest = {
    parent_rule?: null | number;
    student_groups?: Array<number>;
    queue?: null | number;
};

export type QueueRequest = {
    /** @maxLength 100 */
    name: string;
    /** @maxLength 150 */
    description?: string;
    module?: null | number;
    user?: null | number;
};

export type AssignmentStatusEnum =
    (typeof AssignmentStatusEnum)[keyof typeof AssignmentStatusEnum];

export const AssignmentStatusEnum = {
    New: "New",
    Work_In_Progress: "Work In Progress",
    Redo: "Redo",
    Submitted: "Submitted",
    AutoChecked: "AutoChecked",
    Done: "Done",
} as const;

export type Assignment = {
    readonly id: number;
    readonly user: number;
    readonly checker: null | number;
    readonly checker_first_name: string;
    readonly checker_last_name: string;
    readonly is_subscribed: boolean;
    readonly exercise: number;
    assignment_status: AssignmentStatusEnum;
    student_assignment_status?: AssignmentStatusEnum;
    readonly patbas: boolean;
    description?: string;
    submission_count?: number;
    total_check_count?: number;
    manual_check_count?: number;
    readonly last_staff_updated: string;
    flagged?: boolean;
    readonly work_time: number;
    timer?: null | string;
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

export type SyncStatusEnum = (typeof SyncStatusEnum)[keyof typeof SyncStatusEnum];

export const SyncStatusEnum = {
    Creating: "Creating",
    Deleting: "Deleting",
    Normal: "Normal",
    Error: "Error",
} as const;

export type PatbasEnum = (typeof PatbasEnum)[keyof typeof PatbasEnum];

export const PatbasEnum = {
    Never: "Never",
    On_Done: "On Done",
    Always: "Always",
    Staff_Only: "Staff Only",
} as const;

export type ExercisePreviewTypes =
    (typeof ExercisePreviewTypes)[keyof typeof ExercisePreviewTypes];

export const ExercisePreviewTypes = {
    Disabled: "Disabled",
    Markdown: "Markdown",
    PDF: "PDF",
} as const;

export type Exercise = {
    readonly id: number;
    /** @maxLength 100 */
    name: string;
    parent_module: number;
    readonly parent_subject: number;
    readonly parent_module_name: string;
    readonly parent_subject_symbol: string;
    readonly parent_subject_color: string;
    download?: boolean;
    preview?: ExercisePreviewTypes;
    patbas_preview?: ExercisePreviewTypes;
    patbas_download?: boolean;
    is_lecture?: boolean;
    /** @maxLength 100 */
    style?: string;
    readonly parent_subject_name: string;
    readonly parent_module_order: string;
    /** @maxLength 100 */
    order: string;
    tags?: Array<string>;
    patbas?: PatbasEnum;
    /** @maxLength 20 */
    autocheck_tag?: string;
    autodone?: boolean;
    expected_duration?: null | string;
    readonly sync_status: SyncStatusEnum;
    readonly sync_message: string;
    readonly segel_path: string;
    segel_brief?: string;
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

export type Program = {
    readonly id: number;
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
    readonly sync_status: SyncStatusEnum;
    readonly sync_message: string;
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

export type Subject = {
    readonly id: number;
    /** @maxLength 100 */
    symbol: string;
    parent_program: number;
    /** @maxLength 7 */
    color: string;
    /** @maxLength 100 */
    name: string;
    readonly parent_program_name: string;
    readonly sync_status: SyncStatusEnum;
    readonly sync_message: string;
    readonly segel_path: string;
    segel_brief?: string;
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

export type Module = {
    readonly id: number;
    /** @maxLength 100 */
    name: string;
    parent_subject: number;
    /** @maxLength 100 */
    order: string;
    readonly sync_status: SyncStatusEnum;
    readonly sync_message: string;
    readonly parent_program_name: string;
    readonly parent_subject_name: string;
    readonly parent_subject_symbol: string;
    readonly segel_path: string;
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

export type HelpTypeEnum = (typeof HelpTypeEnum)[keyof typeof HelpTypeEnum];

export const HelpTypeEnum = {
    Exercise: "Exercise",
    Medical: "Medical",
    Error: "Error",
    Music: "Music",
    Request: "Request",
    Other: "Other",
    Chat: "Chat",
} as const;

export type HelpStatusEnum = (typeof HelpStatusEnum)[keyof typeof HelpStatusEnum];

export const HelpStatusEnum = {
    Resolved: "Resolved",
    Open: "Open",
} as const;

export type VisibilityEnum = (typeof VisibilityEnum)[keyof typeof VisibilityEnum];

export const VisibilityEnum = {
    All_Staff: "All Staff",
    All_Staff_And_Checkers: "All Staff And Checkers",
    Author_Only: "Author Only",
} as const;

export type Help = {
    readonly id: number;
    user?: number;
    readonly checker: null | number;
    readonly checker_first_name: string;
    readonly checker_last_name: string;
    readonly is_subscribed: boolean;
    /** @maxLength 30 */
    title?: string;
    help_type: HelpTypeEnum;
    readonly help_status: HelpStatusEnum;
    readonly for_exercise: null | Exercise;
    visibility?: VisibilityEnum;
};

export type HelpRequest = {
    user: number;
    /** @maxLength 30 */
    title?: string;
    help_type: HelpTypeEnum;
    exercise_id: null | number;
    visibility?: VisibilityEnum;
};

export type Notification = {
    readonly id: number;
    help?: null | number;
    assignment?: null | number;
    readonly exercise: null | number;
    readonly exercise_name: null | string;
    readonly module: null | number;
    readonly subject: null | number;
    readonly program: null | number;
    readonly help_type: null | HelpTypeEnum;
    readonly help_title: null | string;
    comment?: string;
    readonly from_user: null | number;
    readonly from_user_name: string;
    was_read?: boolean;
    readonly time: string;
    readonly for_user: number;
    readonly for_user_name: string;
};

export type NotificationRequest = {
    help?: null | number;
    assignment?: null | number;
    comment?: string;
    was_read?: boolean;
    user: number;
};

export type ScheduleColor = {
    readonly id: number;
    /** @maxLength 20 */
    name: string;
    /** @maxLength 7 */
    color: string;
};

export type ScheduleColorRequest = {
    /** @maxLength 20 */
    name: string;
    /** @maxLength 7 */
    color: string;
};

export type EventTypeEnum = (typeof EventTypeEnum)[keyof typeof EventTypeEnum];

export const EventTypeEnum = {
    Patbas: "פתבס",
    Lecture: "הרצאה",
    ExerciseEvent: "עע",
} as const;

export type ScheduleEvent = {
    start: string;
    end: string;
    readonly title: null | string;
    readonly subject_id: null | number;
    readonly subject_name: null | string;
    readonly color: null | string;
    type: EventTypeEnum;
    /** @maxLength 100 */
    location?: string;
    readonly module_id: null | number;
    readonly lesson_name: null | string;
};

export type ScheduleEventRequest = {
    start: string;
    end: string;
    type: EventTypeEnum;
    /** @maxLength 100 */
    location?: string;
};

export type ScheduleKiosk = {
    start: string;
    end: string;
    readonly title: null | string;
    readonly subject_id: null | number;
    readonly subject_name: null | string;
    readonly color: null | string;
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

export type SsoApplication = {
    readonly id: number;
    /** @maxLength 255 */
    name?: string;
    /** Allowed URIs list, space separated */
    redirect_uris?: string;
    readonly client_id: string;
    readonly client_secret: string;
    readonly owner: null | string;
    readonly skip_authorization: boolean;
};

export type SsoApplicationRequest = {
    /** @maxLength 255 */
    name?: string;
    /** Allowed URIs list, space separated */
    redirect_uris?: string;
};

export type SsoClientInfo = {
    name: string;
    scopes: Record<string, string>;
};

export type Tag = {
    readonly id: number;
    /** @maxLength 100 */
    name: string;
    /** @maxLength 7 */
    color: string;
};

export type TagRequest = {
    /** @maxLength 100 */
    name: string;
    /** @maxLength 7 */
    color: string;
};

export type Seating = {
    readonly id: number;
    /** @maxLength 255 */
    hostname?: null | string;
    hanich?: null | number;
    classroom: number;
    x: number;
    y: number;
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

export type RegisterCourseUser = {
    /** @maxLength 150 */
    first_name: string;
    /** @maxLength 150 */
    last_name: string;
    /** @maxLength 150 */
    username: string;
    gender: GenderEnum;
    /** @maxLength 128 */
    password: string;
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
