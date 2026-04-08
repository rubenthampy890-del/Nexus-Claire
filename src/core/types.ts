export type KPI = {
    name: string;
    metric?: string;
    target: string;
    check_interval?: string;
};

export type CommunicationStyle = {
    tone: string;
    verbosity: 'concise' | 'detailed' | 'adaptive';
    formality: 'formal' | 'casual' | 'adaptive';
};

export type SubRoleTemplate = {
    role_id: string;
    name: string;
    description: string;
    spawned_by: string;
    reports_to: string;
    max_budget_per_task: number;
};

export type RoleDefinition = {
    id: string;
    name: string;
    description: string;
    responsibilities: string[];
    autonomous_actions: string[];
    approval_required: string[];
    kpis: KPI[];
    communication_style: CommunicationStyle;
    heartbeat_instructions: string;
    sub_roles: SubRoleTemplate[];
    tools: string[];
    authority_level: number;  // 1-10
};
