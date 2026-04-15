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
    private pinnedContext: Map<string, string>;

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
            can_spawn_children: (role.sub_roles?.length || 0) > 0,
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
        this.pinnedContext = new Map();
    }

    get id(): string { return this.agent.id; }
    get status(): AgentStatus { return this.agent.status; }

    setTask(task: string): void { this.agent.current_task = task; }
    clearTask(): void { this.agent.current_task = null; }

    pinContext(key: string, content: string): void {
        this.pinnedContext.set(key, content);
    }

    unpinContext(key: string): void {
        this.pinnedContext.delete(key);
    }

    addMessage(role: 'user' | 'assistant' | 'system', content: string): void {
        this.messageHistory.push({ role, content });
    }

    getMessages(): Message[] {
        let systemMessage = this.messageHistory.find(m => m.role === 'system');

        // Inject pinned context into system message if it exists, or create one
        if (this.pinnedContext.size > 0) {
            let pinnedStr = "\n\n--- PINNED CONTEXT ---\n";
            for (const [key, val] of this.pinnedContext.entries()) {
                pinnedStr += `[${key}]:\n${val}\n\n`;
            }
            pinnedStr += "--- END PINNED CONTEXT ---\n";

            if (systemMessage) {
                // Return a copy with injected context
                systemMessage = { ...systemMessage, content: systemMessage.content + pinnedStr };
            } else {
                systemMessage = { role: 'system', content: pinnedStr };
            }
        }

        if (this.messageHistory.length <= 15 && this.pinnedContext.size === 0)
            return [...this.messageHistory];

        const recentHistory = this.messageHistory.slice(-12);
        const pruned: Message[] = [];

        if (systemMessage) pruned.push(systemMessage);

        for (const msg of recentHistory) {
            // Skip the original system message as we've already pushed the (potentially augmented) one
            if (msg.role !== 'system') pruned.push(msg);
        }

        return pruned;
    }

    terminate(): void {
        this.agent.status = 'terminated';
        this.clearTask();
    }

    /**
     * Serialize agent state for checkpointing.
     */
    getCheckpointState(): { messages: Message[]; contextPins: [string, string][] } {
        return {
            messages: [...this.messageHistory],
            contextPins: Array.from(this.pinnedContext.entries())
        };
    }

    /**
     * Restore agent state from a checkpoint.
     */
    restoreCheckpoint(state: { messages: Message[]; contextPins: [string, string][] }): void {
        this.messageHistory = state.messages || [];
        this.pinnedContext = new Map(state.contextPins || []);
    }
}

export type Message = {
    role: 'user' | 'assistant' | 'system';
    content: string;
    image?: { data: string; mimeType: string };
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

    /**
     * Get all active agents as a flat list for dashboard telemetry.
     */
    public getAllAgents(): Array<{
        id: string; name: string; role: string;
        status: string; authority: number; parentId: string | null;
    }> {
        return Array.from(this.agents.values()).map(a => ({
            id: a.agent.id,
            name: a.agent.role.name,
            role: a.agent.role.description?.substring(0, 60) || a.agent.role.name,
            status: a.agent.status.toUpperCase(),
            authority: a.agent.authority.max_authority_level,
            parentId: a.agent.parent_id
        }));
    }

    /**
     * Build a recursive hierarchy tree for the SwarmView dashboard.
     */
    public getHierarchy(): any {
        const agents = this.getAllAgents();
        if (agents.length === 0) {
            // Return a default "Nexus Prime" root node
            return {
                id: 'nexus-prime',
                name: 'Nexus Prime',
                role: 'Orchestrator',
                status: 'ACTIVE',
                authority: 10,
                parent_id: null,
                children: []
            };
        }

        // Find root agents (no parent)
        const roots = agents.filter(a => !a.parentId);
        const childMap = new Map<string, typeof agents>();
        for (const agent of agents) {
            if (agent.parentId) {
                if (!childMap.has(agent.parentId)) childMap.set(agent.parentId, []);
                childMap.get(agent.parentId)!.push(agent);
            }
        }

        const buildTree = (agent: typeof agents[0]): any => ({
            id: agent.id,
            name: agent.name,
            role: agent.role,
            status: agent.status,
            authority: agent.authority,
            parent_id: agent.parentId,
            children: (childMap.get(agent.id) || []).map(buildTree)
        });

        if (roots.length === 1 && roots[0]) return buildTree(roots[0]);

        // Multiple roots: wrap in a virtual Nexus Prime
        return {
            id: 'nexus-prime',
            name: 'Nexus Prime',
            role: 'Orchestrator',
            status: 'ACTIVE',
            authority: 10,
            parent_id: null,
            children: roots.map(buildTree)
        };
    }
}

export const orchestrator = new NexusOrchestrator();
