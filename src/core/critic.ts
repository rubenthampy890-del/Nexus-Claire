/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — CRITIC TIER v1.0                           ║
 * ║       Zero-Hallucination Guard + before_tool_call Gate          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Adapted from OpenClaw's before_tool_call hook system and
 * anthropic-payload-policy.ts validation patterns.
 *
 * The Critic audits every Architect plan and gates every tool execution:
 *   1. File Path Validation: verifies referenced paths exist
 *   2. Tool Parameter Check: validates params against schema
 *   3. Circular Logic Detection: catches self-referencing plans
 *   4. Confidence Scoring: 0-1 score, below threshold triggers re-gen
 *   5. Risk Gating: dangerous tools require user approval
 */

import { existsSync } from "node:fs";
import type { ToolCallDecision, ToolExecutionContext } from "./tool-registry";
import { toolRegistry } from "./tool-registry";

/* ─── Types ─── */

export interface CriticAuditResult {
    passed: boolean;
    confidence: number;        // 0.0 - 1.0
    issues: CriticIssue[];
    suggestions: string[];
}

export interface CriticIssue {
    severity: 'error' | 'warning' | 'info';
    category: 'path' | 'tool' | 'logic' | 'security' | 'quality';
    message: string;
    location?: string;         // e.g. "step 3", "parameter: path"
}

export interface StepTreeNode {
    id: string;
    action: string;
    toolName?: string;
    parameters?: Record<string, any>;
    children?: StepTreeNode[];
    dependsOn?: string[];
}

/* ─── Critic ─── */

export class NexusCritic {
    private confidenceThreshold = 0.6;
    private auditLog: Array<{ timestamp: number; planSummary: string; result: CriticAuditResult }> = [];

    /**
     * Audit an Architect's StepTree plan before execution.
     * Returns a pass/fail with detailed issue reporting.
     */
    public audit(plan: string | StepTreeNode[], context?: string): CriticAuditResult {
        const issues: CriticIssue[] = [];
        const suggestions: string[] = [];
        let confidence = 1.0;

        // Parse plan into steps if it's a string
        const steps = typeof plan === 'string' ? this.extractStepsFromText(plan) : plan;

        // 1. File Path Validation
        const pathIssues = this.validateFilePaths(plan);
        issues.push(...pathIssues);
        confidence -= pathIssues.filter(i => i.severity === 'error').length * 0.15;

        // 2. Tool Parameter Check
        const toolIssues = this.validateToolCalls(steps);
        issues.push(...toolIssues);
        confidence -= toolIssues.filter(i => i.severity === 'error').length * 0.1;

        // 3. Circular Logic Detection
        const circularIssues = this.detectCircularLogic(steps);
        issues.push(...circularIssues);
        confidence -= circularIssues.length * 0.2;

        // 4. Security Check
        const securityIssues = this.checkSecurity(plan);
        issues.push(...securityIssues);
        confidence -= securityIssues.filter(i => i.severity === 'error').length * 0.25;

        // 5. Quality Score
        const qualityIssues = this.assessQuality(plan, context);
        issues.push(...qualityIssues);
        confidence -= qualityIssues.filter(i => i.severity === 'warning').length * 0.05;

        // Clamp confidence
        confidence = Math.max(0, Math.min(1, confidence));

        // Generate suggestions
        if (confidence < this.confidenceThreshold) {
            suggestions.push("Consider re-generating the plan with more specific constraints.");
        }
        for (const issue of issues) {
            if (issue.severity === 'error' && issue.category === 'path') {
                suggestions.push(`Search for the actual file path before referencing it.`);
            }
            if (issue.category === 'security') {
                suggestions.push(`Use a safer alternative or request explicit user approval.`);
            }
        }

        const result: CriticAuditResult = {
            passed: confidence >= this.confidenceThreshold && issues.filter(i => i.severity === 'error').length === 0,
            confidence,
            issues,
            suggestions: [...new Set(suggestions)],
        };

        // Log the audit
        const planSummary = typeof plan === 'string'
            ? plan.substring(0, 100)
            : `StepTree with ${steps.length} nodes`;
        this.auditLog.push({ timestamp: Date.now(), planSummary, result });

        const emoji = result.passed ? '✅' : '❌';
        console.log(`[CRITIC] ${emoji} Audit: confidence=${confidence.toFixed(2)}, issues=${issues.length}, passed=${result.passed}`);

        return result;
    }

    /**
     * before_tool_call gate: registers as a hook on the ToolRegistry.
     * Every tool execution passes through this gate.
     */
    public createToolGateHook(): (toolName: string, params: Record<string, any>, context: ToolExecutionContext) => Promise<ToolCallDecision> {
        return async (toolName: string, params: Record<string, any>, context: ToolExecutionContext): Promise<ToolCallDecision> => {
            const tool = toolRegistry.getTool(toolName);
            if (!tool) {
                return { action: 'block', reason: `Tool "${toolName}" does not exist in the registry.` };
            }

            // 1. Check if tool is optional and not allowlisted
            if (tool.optional) {
                // For now, allow all optional tools but log it
                console.log(`[CRITIC] ⚡ Optional tool invoked: ${toolName}`);
            }

            // 2. Risk-based gating
            if (tool.riskLevel === 'dangerous') {
                // Check specific dangerous patterns in params
                const paramStr = JSON.stringify(params).toLowerCase();
                const immediateBlock = ['rm -rf /', 'sudo rm', 'mkfs', 'dd if=/dev/zero'];
                for (const pattern of immediateBlock) {
                    if (paramStr.includes(pattern)) {
                        return { action: 'block', reason: `Dangerous pattern detected: "${pattern}"` };
                    }
                }

                // Require approval for dangerous tools
                return {
                    action: 'requireApproval',
                    reason: `Dangerous tool "${toolName}" requires user approval.`,
                    approvalId: `critic-${Date.now()}-${toolName}`,
                };
            }

            // 3. File path validation for file-ops tools
            if (tool.category === 'file-ops' && params.path) {
                const path = params.path as string;
                // Block writes to system directories
                const systemDirs = ['/System', '/usr/bin', '/etc', '/var/root'];
                for (const dir of systemDirs) {
                    if (path.startsWith(dir)) {
                        return { action: 'block', reason: `Cannot write to system directory: ${dir}` };
                    }
                }
            }

            // 4. Terminal command validation
            if (toolName === 'terminal.run' && params.command) {
                const cmd = (params.command as string).toLowerCase();
                const blockedCommands = ['sudo rm -rf /', 'dd if=/dev/zero', ':(){ :|:& };:', 'chmod -R 777 /'];
                for (const blocked of blockedCommands) {
                    if (cmd.includes(blocked)) {
                        return { action: 'block', reason: `Blocked destructive command: "${blocked}"` };
                    }
                }
            }

            return { action: 'allow' };
        };
    }

    /* ─── Validation Subroutines ─── */

    private validateFilePaths(plan: string | StepTreeNode[]): CriticIssue[] {
        const issues: CriticIssue[] = [];
        const text = typeof plan === 'string' ? plan : JSON.stringify(plan);

        // Extract file paths from the plan
        const pathRegex = /(?:\/[\w.-]+){2,}/g;
        const paths = text.match(pathRegex) || [];

        for (const path of paths) {
            // Only validate absolute paths that look like file references
            if (path.startsWith('/Users/') || path.startsWith('/home/') || path.startsWith('/tmp/')) {
                if (!existsSync(path)) {
                    issues.push({
                        severity: 'error',
                        category: 'path',
                        message: `Referenced path does not exist: ${path}`,
                        location: path,
                    });
                }
            }
        }

        return issues;
    }

    private validateToolCalls(steps: StepTreeNode[]): CriticIssue[] {
        const issues: CriticIssue[] = [];

        for (const step of steps) {
            if (step.toolName) {
                const tool = toolRegistry.getTool(step.toolName);
                if (!tool) {
                    issues.push({
                        severity: 'error',
                        category: 'tool',
                        message: `Tool "${step.toolName}" is not registered.`,
                        location: `step ${step.id}`,
                    });
                } else if (step.parameters) {
                    // Check required parameters
                    for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
                        if (paramDef.required && !(paramName in step.parameters)) {
                            issues.push({
                                severity: 'error',
                                category: 'tool',
                                message: `Missing required parameter "${paramName}" for tool "${step.toolName}".`,
                                location: `step ${step.id}`,
                            });
                        }
                    }

                    // Check for empty string params
                    for (const [paramName, value] of Object.entries(step.parameters)) {
                        if (value === '' || value === null || value === undefined) {
                            issues.push({
                                severity: 'warning',
                                category: 'quality',
                                message: `Parameter "${paramName}" is empty in tool "${step.toolName}".`,
                                location: `step ${step.id}`,
                            });
                        }
                    }
                }
            }

            // Recurse into children
            if (step.children) {
                issues.push(...this.validateToolCalls(step.children));
            }
        }

        return issues;
    }

    private detectCircularLogic(steps: StepTreeNode[]): CriticIssue[] {
        const issues: CriticIssue[] = [];
        const visited = new Set<string>();

        const checkCycle = (node: StepTreeNode, ancestors: Set<string>) => {
            if (ancestors.has(node.id)) {
                issues.push({
                    severity: 'error',
                    category: 'logic',
                    message: `Circular dependency detected: step "${node.id}" references itself.`,
                    location: `step ${node.id}`,
                });
                return;
            }

            if (visited.has(node.id)) return;
            visited.add(node.id);

            const newAncestors = new Set(ancestors);
            newAncestors.add(node.id);

            for (const dep of node.dependsOn || []) {
                if (newAncestors.has(dep)) {
                    issues.push({
                        severity: 'error',
                        category: 'logic',
                        message: `Circular dependency: "${node.id}" depends on "${dep}" which is an ancestor.`,
                    });
                }
            }

            for (const child of node.children || []) {
                checkCycle(child, newAncestors);
            }
        };

        for (const step of steps) {
            checkCycle(step, new Set());
        }

        return issues;
    }

    private checkSecurity(plan: string | StepTreeNode[]): CriticIssue[] {
        const issues: CriticIssue[] = [];
        const text = typeof plan === 'string' ? plan : JSON.stringify(plan);
        const lower = text.toLowerCase();

        const dangerous = [
            { pattern: 'rm -rf /', message: 'Recursive force delete on root directory' },
            { pattern: 'sudo', message: 'Elevated privileges requested' },
            { pattern: 'chmod 777', message: 'World-writable permissions' },
            { pattern: 'eval(', message: 'Dynamic code evaluation' },
            { pattern: 'process.env', message: 'Direct environment variable access' },
            { pattern: '/etc/passwd', message: 'System password file access' },
            { pattern: 'DROP TABLE', message: 'SQL destructive operation' },
        ];

        for (const { pattern, message } of dangerous) {
            if (lower.includes(pattern.toLowerCase())) {
                issues.push({
                    severity: 'error',
                    category: 'security',
                    message: `Security concern: ${message} (matched: "${pattern}")`,
                });
            }
        }

        return issues;
    }

    private assessQuality(plan: string | StepTreeNode[], context?: string): CriticIssue[] {
        const issues: CriticIssue[] = [];
        const text = typeof plan === 'string' ? plan : JSON.stringify(plan);

        // Check for vague language
        const vagueTerms = ['maybe', 'probably', 'i think', 'could try', 'not sure'];
        for (const term of vagueTerms) {
            if (text.toLowerCase().includes(term)) {
                issues.push({
                    severity: 'info',
                    category: 'quality',
                    message: `Plan contains uncertain language: "${term}"`,
                });
            }
        }

        // Check for excessively short plans
        if (text.length < 20) {
            issues.push({
                severity: 'warning',
                category: 'quality',
                message: 'Plan is very short. Consider adding more detail.',
            });
        }

        return issues;
    }

    /* ─── Helpers ─── */

    private extractStepsFromText(plan: string): StepTreeNode[] {
        // Try to parse as JSON StepTree
        try {
            const parsed = JSON.parse(plan);
            if (Array.isArray(parsed)) return parsed;
            if (parsed.steps) return parsed.steps;
        } catch { }

        // Fallback: extract [EXEC:] blocks
        const execBlocks = plan.match(/\[EXEC:\s*([^\]]+)\]/g) || [];
        return execBlocks.map((block, i) => {
            const content = block.replace(/\[EXEC:\s*/, '').replace(']', '');
            return {
                id: `step-${i + 1}`,
                action: content.trim(),
            };
        });
    }

    /* ─── Diagnostics ─── */

    public getAuditLog(): typeof this.auditLog {
        return [...this.auditLog];
    }

    public getStats(): { totalAudits: number; passRate: number; avgConfidence: number } {
        const total = this.auditLog.length;
        if (total === 0) return { totalAudits: 0, passRate: 0, avgConfidence: 0 };

        const passed = this.auditLog.filter(a => a.result.passed).length;
        const avgConf = this.auditLog.reduce((sum, a) => sum + a.result.confidence, 0) / total;

        return {
            totalAudits: total,
            passRate: passed / total,
            avgConfidence: avgConf,
        };
    }

    public setConfidenceThreshold(threshold: number): void {
        this.confidenceThreshold = Math.max(0, Math.min(1, threshold));
        console.log(`[CRITIC] Confidence threshold set to ${this.confidenceThreshold}`);
    }
}

export const nexusCritic = new NexusCritic();
