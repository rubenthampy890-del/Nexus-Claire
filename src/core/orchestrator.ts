import { type RoleDefinition } from "./types";

export type AgentStatus = 'active' | 'idle' | 'terminated';

export type AuthorityBounds = {
    max_authority_level: number;
    allowed_tools: string[];
    denied_tools: string[];
    max_token_budget: number;
    can_spawn_children: boolean;
};

export type Agent = {
    id: string;
    role: RoleDefinition;
    parent_id: string | null;
    status: AgentStatus;
    session_id: string;
    current_task: string | null;
    authority: AuthorityBounds;
    memory_scope: string[];
    created_at: number;
};

export class AgentInstance {
    public readonly agent: Agent;
    private messageHistory: Message[];

    constructor(
        role: RoleDefinition,
        opts?: {
            parent_id?: string;
            authority?: Partial<AuthorityBounds>;
            memory_scope?: string[];
        }
    ) {
        const defaultAuth: AuthorityBounds = {
            max_authority_level: role.authority_level,
            allowed_tools: role.tools,
            denied_tools: [],
            max_token_budget: 100000,
            can_spawn_children: role.sub_roles.length > 0,
        };

        const authority: AuthorityBounds = {
            ...defaultAuth,
            ...opts?.authority,
        };

        this.agent = {
            id: crypto.randomUUID(),
            role,
            parent_id: opts?.parent_id ?? null,
            status: 'active',
            session_id: crypto.randomUUID(),
            current_task: null,
            authority,
            memory_scope: opts?.memory_scope ?? [],
            created_at: Date.now(),
        };

        this.messageHistory = [];
    }

    get id(): string { return this.agent.id; }
    get status(): AgentStatus { return this.agent.status; }

    setTask(task: string): void { this.agent.current_task = task; }
    clearTask(): void { this.agent.current_task = null; }

    addMessage(role: 'user' | 'assistant' | 'system', content: string): void {
        this.messageHistory.push({ role, content });
    }

    getMessages(): Message[] {
        if (this.messageHistory.length <= 15) return [...this.messageHistory];

        // Preservation strategy: Keep the first message (usually system prompt)
        // and the most recent context (last 12 messages).
        const systemMessage = this.messageHistory.find(m => m.role === 'system');
        const recentHistory = this.messageHistory.slice(-12);

        const pruned: Message[] = [];
        if (systemMessage) pruned.push(systemMessage);

        // Avoid duplicating if system message was in the last 12
        for (const msg of recentHistory) {
            if (msg !== systemMessage) pruned.push(msg);
        }

        return pruned;
    }

    terminate(): void {
        this.agent.status = 'terminated';
        this.clearTask();
    }
}

export type Message = {
    role: 'user' | 'assistant' | 'system';
    content: string;
};

export class NexusOrchestrator {
    private agents = new Map<string, AgentInstance>();
    private hierarchy = new Map<string, Set<string>>(); // parent -> children

    public spawnAgent(role: RoleDefinition, parentId: string | null = null): AgentInstance {
        const agent = new AgentInstance(role, { parent_id: parentId ?? undefined });
        this.agents.set(agent.id, agent);

        if (parentId) {
            if (!this.hierarchy.has(parentId)) this.hierarchy.set(parentId, new Set());
            this.hierarchy.get(parentId)!.add(agent.id);
        }

        console.log(`[ORCHESTRATOR] Spawned agent ${agent.id} (Role: ${role.name})`);
        return agent;
    }

    public getAgent(id: string): AgentInstance | undefined {
        return this.agents.get(id);
    }

    public terminateAgent(id: string): void {
        const agent = this.agents.get(id);
        if (!agent) return;

        // Recursive termination
        const children = this.hierarchy.get(id);
        if (children) {
            for (const childId of children) {
                this.terminateAgent(childId);
            }
        }

        agent.terminate();
        console.log(`[ORCHESTRATOR] Terminated agent ${id}`);
    }
}

export const orchestrator = new NexusOrchestrator();
