import type { RoleDefinition } from "./types";
import { type ToolDefinition } from "./registry";

export type AuthorityDecision = {
    allowed: boolean;
    requiresApproval: boolean;
    reason: string;
};

/**
 * AuthorityEngine — The security gatekeeper of Nexus Claire.
 * It decides if an agent's role allows it to execute a specific tool.
 */
export class AuthorityEngine {
    private static instance: AuthorityEngine;

    private constructor() { }

    public static getInstance(): AuthorityEngine {
        if (!AuthorityEngine.instance) {
            AuthorityEngine.instance = new AuthorityEngine();
        }
        return AuthorityEngine.instance;
    }

    /**
     * Decides if an agent can execute a tool based on its role.
     */
    public checkAuthority(role: RoleDefinition, tool: ToolDefinition, params: Record<string, any>): AuthorityDecision {
        const toolName = tool.name;
        const category = this.mapToolToCategory(tool, params);

        // 1. Explicit Autonomous Check
        if (role.autonomous_actions.includes(toolName) || role.autonomous_actions.includes(category)) {
            return { allowed: true, requiresApproval: false, reason: "Action is explicitly autonomous for this role." };
        }

        // 2. Explicit Approval Check
        if (role.approval_required.includes(toolName) || role.approval_required.includes(category)) {
            return { allowed: true, requiresApproval: true, reason: "Action is explicitly marked as requiring approval." };
        }

        // 3. Categorical Logic
        if (category === 'read' || category === 'intelligence') {
            return { allowed: true, requiresApproval: false, reason: "Read-only actions are allowed by default." };
        }

        // 4. Authority Level Floor
        // If the role has low authority (< 5), any write/unsafe action requires approval.
        if (role.authority_level < 5 && (category === 'write' || category === 'unsafe')) {
            return { allowed: true, requiresApproval: true, reason: "Low authority role requires approval for state-changing actions." };
        }

        // 5. Default Fallback
        // For higher authority roles, we allow writing by default unless explicitly blocked.
        return {
            allowed: true,
            requiresApproval: role.authority_level < 7, // Level 7+ is trusted for non-governed writes
            reason: role.authority_level >= 7 ? "Trusted high-authority role." : "Action requires verification for this authority level."
        };
    }

    /**
     * Maps a tool and its params to a logical safety category.
     */
    private mapToolToCategory(tool: ToolDefinition, params: Record<string, any>): string {
        const name = tool.name.toLowerCase();

        if (name.includes('delete') || name.includes('remove') || name.includes('rm')) return 'unsafe';
        if (name.includes('write') || name.includes('edit') || name.includes('run')) return 'write';
        if (name.includes('read') || name.includes('list') || name.includes('get')) return 'read';

        // Category based mapping
        switch (tool.category) {
            case 'file-ops': return name.includes('read') ? 'read' : 'write';
            case 'terminal': return 'write'; // Shell commands are always state-changing
            case 'browser': return 'read';
            case 'intelligence': return 'intelligence';
            default: return 'general';
        }
    }
}

export const authorityEngine = AuthorityEngine.getInstance();
