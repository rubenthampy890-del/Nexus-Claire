/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — DYNAMIC TOOL REGISTRY v2.0                 ║
 * ║       OpenClaw-Inspired: Hot-load, Conflict Detection, Provenance║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Adapted from OpenClaw's registry.ts + api-builder.ts patterns:
 *   - registerTool() / unregisterTool() / reloadTool()
 *   - Conflict detection: cannot overwrite core tools
 *   - Provenance tracking: core | learned | user-authored
 *   - before_tool_call gate: Critic can block/approve/pause execution
 *   - Hot-reload from disk without restart
 *
 * Backwards-compatible with the existing ToolRegistry export.
 */

import { existsSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";

/* ─── Types ─── */

export type ToolParameterType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export type ToolParameter = {
    type: ToolParameterType;
    description: string;
    required: boolean;
    default?: any;
    enum?: string[];
};

export type ToolResult = {
    content: Array<{ type: 'text'; text: string } | { type: 'error'; text: string }>;
    metadata?: Record<string, any>;
};

export type ToolProvenance = 'core' | 'learned' | 'user-authored';

export type ToolRiskLevel = 'safe' | 'moderate' | 'dangerous';

export interface ToolDefinition {
    name: string;
    description: string;
    category: 'terminal' | 'file-ops' | 'browser' | 'general' | 'communication' | 'intelligence' | 'system' | 'custom';
    parameters: Record<string, ToolParameter>;
    execute: (params: Record<string, any>, context?: ToolExecutionContext) => Promise<string | any>;

    // OpenClaw-inspired extensions
    provenance?: ToolProvenance;
    optional?: boolean;          // User must opt-in (from OpenClaw's { optional: true })
    riskLevel?: ToolRiskLevel;   // For exec preflight classification
    timeout?: number;            // Max execution time in ms (default 30000)
    version?: string;
    author?: string;             // 'nexus' for self-authored, 'user' for user-created
    createdAt?: number;
    lastUsedAt?: number;
    useCount?: number;
}

export type ToolExecutionContext = {
    agentId: string;
    conversationId?: string;
    parentToolCall?: string;
};

/** 
 * Hook that runs before every tool execution.
 * Adapted from OpenClaw's before_tool_call hook system.
 */
export type BeforeToolCallHook = (
    toolName: string,
    params: Record<string, any>,
    context: ToolExecutionContext
) => Promise<ToolCallDecision>;

export type ToolCallDecision =
    | { action: 'allow' }
    | { action: 'block'; reason: string }
    | { action: 'requireApproval'; reason: string; approvalId?: string };

/** Event emitted after tool execution */
export type ToolExecutionEvent = {
    toolName: string;
    params: Record<string, any>;
    result: string;
    durationMs: number;
    success: boolean;
    context: ToolExecutionContext;
    timestamp: number;
};

export type ToolEventListener = (event: ToolExecutionEvent) => void;

/* ─── Registry ─── */

export class NexusToolRegistry {
    private tools = new Map<string, ToolDefinition>();
    private coreToolNames = new Set<string>();  // Protected: cannot be overwritten
    private beforeHooks: BeforeToolCallHook[] = [];
    private eventListeners: ToolEventListener[] = [];
    private pendingApprovals = new Map<string, { resolve: (approved: boolean) => void; toolName: string; reason: string }>();
    private learnedToolsDir: string;

    constructor() {
        this.learnedToolsDir = join(process.cwd(), "learned-skills", "tools");
    }

    /* ─── Registration (OpenClaw api.registerTool pattern) ─── */

    /**
     * Register a tool. Core tools cannot be overwritten by non-core sources.
     * Adapted from OpenClaw's `api.registerTool()` with conflict detection.
     */
    public register(tool: ToolDefinition): boolean {
        const provenance = tool.provenance || 'core';

        // Conflict detection: don't let learned/user tools overwrite core tools
        if (this.coreToolNames.has(tool.name) && provenance !== 'core') {
            console.warn(`[TOOL REGISTRY] ⚠️ Conflict: "${tool.name}" is a core tool and cannot be overwritten by ${provenance} source.`);
            return false;
        }

        // Set defaults
        tool.provenance = provenance;
        tool.riskLevel = tool.riskLevel || this.classifyRisk(tool);
        tool.timeout = tool.timeout || 30000;
        tool.useCount = tool.useCount || 0;
        tool.createdAt = tool.createdAt || Date.now();

        this.tools.set(tool.name, tool);

        // Track core tool names for conflict protection
        if (provenance === 'core') {
            this.coreToolNames.add(tool.name);
        }

        console.log(`[TOOL REGISTRY] ✅ Registered: ${tool.name} [${provenance}] (${tool.category}) risk=${tool.riskLevel}`);
        return true;
    }

    /**
     * Unregister a tool. Core tools can only be unregistered with force=true.
     */
    public unregister(name: string, force = false): boolean {
        if (this.coreToolNames.has(name) && !force) {
            console.warn(`[TOOL REGISTRY] Cannot unregister core tool: ${name}. Use force=true.`);
            return false;
        }

        const removed = this.tools.delete(name);
        if (removed) {
            this.coreToolNames.delete(name);
            console.log(`[TOOL REGISTRY] 🗑️ Unregistered: ${name}`);
        }
        return removed;
    }

    /**
     * Hot-reload a tool from its source file.
     * Adapted from OpenClaw's registerReload() pattern.
     */
    public async reloadTool(name: string): Promise<boolean> {
        const existing = this.tools.get(name);
        if (!existing) return false;

        if (existing.provenance === 'learned') {
            // Re-read from disk
            const toolFile = join(this.learnedToolsDir, `${name}.json`);
            if (existsSync(toolFile)) {
                try {
                    const spec = JSON.parse(readFileSync(toolFile, 'utf8'));
                    existing.description = spec.description || existing.description;
                    existing.parameters = spec.parameters || existing.parameters;
                    console.log(`[TOOL REGISTRY] 🔄 Hot-reloaded: ${name}`);
                    return true;
                } catch (e: any) {
                    console.error(`[TOOL REGISTRY] Failed to reload ${name}: ${e.message}`);
                }
            }
        }
        return false;
    }

    /* ─── Execution (with before_tool_call hooks) ─── */

    /**
     * Execute a tool with full hook pipeline.
     * Adapted from OpenClaw's before_tool_call → execute → event flow.
     */
    public async executeTool(
        name: string,
        params: Record<string, any>,
        context: ToolExecutionContext
    ): Promise<string> {
        const tool = this.tools.get(name);
        if (!tool) return `Error: Tool '${name}' not found in registry.`;

        // Run before_tool_call hooks (Critic gate)
        for (const hook of this.beforeHooks) {
            try {
                const decision = await hook(name, params, context);

                if (decision.action === 'block') {
                    console.log(`[TOOL REGISTRY] 🛑 Blocked: ${name} — ${decision.reason}`);
                    return `[BLOCKED] Tool '${name}' was blocked by the Critic: ${decision.reason}`;
                }

                if (decision.action === 'requireApproval') {
                    console.log(`[TOOL REGISTRY] ⏸️ Approval required for: ${name} — ${decision.reason}`);
                    const approved = await this.waitForApproval(name, decision.reason, decision.approvalId);
                    if (!approved) {
                        return `[DENIED] Tool '${name}' was not approved by the user.`;
                    }
                }
            } catch (e: any) {
                console.warn(`[TOOL REGISTRY] Hook error for ${name}: ${e.message}`);
            }
        }

        // Execute with timeout
        const startTime = Date.now();
        let result: string;
        let success = true;

        try {
            const timeoutMs = tool.timeout || 30000;
            const execPromise = tool.execute(params, context);
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Tool '${name}' timed out after ${timeoutMs}ms`)), timeoutMs)
            );

            const rawResult = await Promise.race([execPromise, timeoutPromise]);
            result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);

            // Update usage stats
            tool.useCount = (tool.useCount || 0) + 1;
            tool.lastUsedAt = Date.now();
        } catch (err: any) {
            success = false;
            result = `Error executing tool '${name}': ${err.message}`;
            console.error(`[TOOL REGISTRY] ${name} failed:`, err.message);
        }

        const durationMs = Date.now() - startTime;

        // Emit execution event
        const event: ToolExecutionEvent = {
            toolName: name,
            params,
            result: result.substring(0, 500), // Truncate for event storage
            durationMs,
            success,
            context,
            timestamp: Date.now(),
        };
        this.emitEvent(event);

        if (durationMs > 5000) {
            console.log(`[TOOL REGISTRY] ⏱️ ${name} took ${durationMs}ms`);
        }

        return result;
    }

    /* ─── Hooks (OpenClaw before_tool_call pattern) ─── */

    /**
     * Register a before_tool_call hook. Runs before every tool execution.
     * Priority: hooks run in registration order (first registered = first called).
     */
    public registerBeforeHook(hook: BeforeToolCallHook): void {
        this.beforeHooks.push(hook);
        console.log(`[TOOL REGISTRY] 🪝 Registered before_tool_call hook (total: ${this.beforeHooks.length})`);
    }

    /**
     * Register an event listener for post-execution events.
     */
    public onToolExecuted(listener: ToolEventListener): void {
        this.eventListeners.push(listener);
    }

    private emitEvent(event: ToolExecutionEvent): void {
        for (const listener of this.eventListeners) {
            try { listener(event); } catch { }
        }
    }

    /* ─── Approval System ─── */

    private async waitForApproval(toolName: string, reason: string, approvalId?: string): Promise<boolean> {
        const id = approvalId || `approval-${Date.now()}-${toolName}`;

        // Auto-approve after 60 seconds if no response (configurable)
        return new Promise<boolean>((resolve) => {
            this.pendingApprovals.set(id, { resolve, toolName, reason });

            // Timeout: auto-deny after 120s
            setTimeout(() => {
                if (this.pendingApprovals.has(id)) {
                    this.pendingApprovals.delete(id);
                    resolve(false);
                    console.log(`[TOOL REGISTRY] ⏰ Approval for ${toolName} timed out.`);
                }
            }, 120_000);
        });
    }

    /**
     * Approve or deny a pending tool execution.
     * Called from Telegram bot, Dashboard, etc.
     */
    public resolveApproval(approvalId: string, approved: boolean): boolean {
        const pending = this.pendingApprovals.get(approvalId);
        if (!pending) return false;

        pending.resolve(approved);
        this.pendingApprovals.delete(approvalId);
        console.log(`[TOOL REGISTRY] ${approved ? '✅' : '❌'} Approval ${approvalId}: ${approved ? 'GRANTED' : 'DENIED'}`);
        return true;
    }

    public getPendingApprovals(): Array<{ id: string; toolName: string; reason: string }> {
        return Array.from(this.pendingApprovals.entries()).map(([id, data]) => ({
            id,
            toolName: data.toolName,
            reason: data.reason,
        }));
    }

    /* ─── Risk Classification (from OpenClaw bash-tools.exec.ts) ─── */

    private classifyRisk(tool: ToolDefinition): ToolRiskLevel {
        const name = tool.name.toLowerCase();
        const desc = tool.description.toLowerCase();

        // Dangerous: anything that writes to filesystem, runs shell, or manages system
        if (name.includes('delete') || name.includes('remove') || name.includes('sudo')) return 'dangerous';
        if (name === 'terminal.run' || name === 'fs.delete') return 'dangerous';
        if (desc.includes('delete') || desc.includes('destroy') || desc.includes('sudo')) return 'dangerous';

        // Moderate: write operations
        if (name.includes('write') || name.includes('install') || name.includes('create')) return 'moderate';
        if (name === 'fs.write' || name.includes('set_clipboard')) return 'moderate';
        if (desc.includes('modif') || desc.includes('overwrite')) return 'moderate';

        // Safe: read-only operations
        return 'safe';
    }

    /* ─── Query & Discovery ─── */

    public getTool(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    public listTools(filter?: { category?: string; provenance?: ToolProvenance; riskLevel?: ToolRiskLevel }): ToolDefinition[] {
        let tools = Array.from(this.tools.values());

        if (filter?.category) tools = tools.filter(t => t.category === filter.category);
        if (filter?.provenance) tools = tools.filter(t => t.provenance === filter.provenance);
        if (filter?.riskLevel) tools = tools.filter(t => t.riskLevel === filter.riskLevel);

        return tools;
    }

    public getToolNames(): string[] {
        return Array.from(this.tools.keys());
    }

    public getStats(): {
        total: number;
        core: number;
        learned: number;
        userAuthored: number;
        mostUsed: Array<{ name: string; useCount: number }>;
    } {
        const tools = Array.from(this.tools.values());
        return {
            total: tools.length,
            core: tools.filter(t => t.provenance === 'core').length,
            learned: tools.filter(t => t.provenance === 'learned').length,
            userAuthored: tools.filter(t => t.provenance === 'user-authored').length,
            mostUsed: tools
                .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
                .slice(0, 5)
                .map(t => ({ name: t.name, useCount: t.useCount || 0 })),
        };
    }

    /* ─── Backwards Compatibility ─── */

    /** @deprecated Use listTools() instead */
    public listToolsLegacy(category?: string): ToolDefinition[] {
        const all = Array.from(this.tools.values());
        if (category) return all.filter(t => t.category === category);
        return all;
    }
}

/** Singleton instance — backwards compatible with `import { toolRegistry }` */
export const toolRegistry = new NexusToolRegistry();

/* Re-export types for backwards compatibility */
export type { ToolParameter as ToolParameterLegacy };
