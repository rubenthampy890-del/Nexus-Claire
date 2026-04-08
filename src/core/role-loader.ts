import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import type { RoleDefinition } from "./types";

/**
 * RoleLoader — Responsible for loading and parsing declarative specialist roles.
 */
export class RoleLoader {
    private static instance: RoleLoader;
    private cache: Map<string, RoleDefinition> = new Map();
    private rolesDir: string;

    private constructor() {
        // Assume 'roles' directory is in the project root
        this.rolesDir = join(process.cwd(), "roles");
    }

    public static getInstance(): RoleLoader {
        if (!RoleLoader.instance) {
            RoleLoader.instance = new RoleLoader();
        }
        return RoleLoader.instance;
    }

    /**
     * Load a role by its ID (filename without .yaml extension)
     */
    public loadRole(roleId: string): RoleDefinition {
        if (this.cache.has(roleId)) {
            return this.cache.get(roleId)!;
        }

        const rolePath = join(this.rolesDir, `${roleId}.yaml`);
        if (!existsSync(rolePath)) {
            throw new Error(`[RoleLoader] Role file not found for ID: ${roleId} at ${rolePath}`);
        }

        try {
            const content = readFileSync(rolePath, "utf8");
            const raw = load(content) as any;

            // Map and validate fields to RoleDefinition
            const role: RoleDefinition = {
                id: raw.id || roleId,
                name: raw.name || "Specialist Agent",
                description: raw.description || "",
                responsibilities: raw.responsibilities || [],
                autonomous_actions: raw.autonomous_actions || [],
                approval_required: raw.approval_required || [],
                kpis: (raw.kpis || []).map((k: any) => ({
                    name: k.name,
                    target: k.target,
                    metric: k.metric,
                    check_interval: k.check_interval
                })),
                communication_style: {
                    tone: raw.communication_style?.tone || "professional",
                    verbosity: raw.communication_style?.verbosity || "concise",
                    formality: raw.communication_style?.formality || "formal"
                },
                heartbeat_instructions: raw.heartbeat_instructions || "",
                sub_roles: raw.sub_roles || [],
                tools: raw.allowed_tools || raw.tools || [],
                authority_level: raw.authority_level || 5
            };

            this.cache.set(roleId, role);
            return role;
        } catch (error) {
            console.error(`[RoleLoader] Error parsing role ${roleId}:`, error);
            throw error;
        }
    }

    /**
     * Clear the cache (use when updating YAMLs)
     */
    public refresh(): void {
        this.cache.clear();
    }
}

export const roleLoader = RoleLoader.getInstance();
