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

    /* ─── Adaptive Trust (Friction Reduction) ─── */
    private trustedPatterns: Set<string> = new Set(['git status', 'git branch', 'npm --version', 'node --version']);
    private sessionTrustUntil: number = 0;

    /* ─── MacOS Security Shield Lists ─── */
    private readonly FORBIDDEN_MAC_COMMANDS = [
        'csrutil disable', 'csrutil clear',          // SIP disabling
        'tmutil delete', 'tmutil thin',              // Time Machine backup destruction
        'diskutil eraseDisk', 'diskutil partitionDisk', // Data wiping
        'diskutil eraseVolume', 'diskutil format',
        'nvram -d', 'nvram -c',                     // Firmware tampering
        'rm -rf /', 'rm -rf /*', 'rm -f /*',
        'chmod -R 000 /', 'chown -R root /',
        'mv /* /dev/null', 'dd if=/dev/zero',        // Data destruction patterns
        'mkfs', 'mkswap', ':(){ :|:& };:'            // General Linux/Unix destruction
    ];

    private readonly HIGH_RISK_MAC_COMMANDS = [
        'launchctl unload', 'launchctl load', 'launchctl remove', // Service disruption
        'networksetup', 'scutil',                                 // Network tampering
        'defaults write com.apple.', 'defaults delete',           // Global pref changes
        'dscl', 'dseditgroup', 'pwpolicy',                        // User/Security policies
        'pmset', 'caffeinate',                                    // Power management
        'kextload', 'kextunload', 'kextutil',                     // Kernel extensions
        'softwareupdate --install',                               // Unexpected updates
        'pkill', 'killall', 'xattr -d com.apple.quarantine'       // Process/File attribute tampering
    ];

    private readonly PROTECTED_MAC_PATHS = [
        '/System', '/Library', '/usr/bin', '/usr/sbin', '/etc', '/var/root',
        '~/Library/Keychains', '~/Library/Safari', '~/Library/Mail', '~/Library/Messages',
        '~/Library/Containers', '~/.ssh', '~/.aws', '~/.config/nexus-claire'
    ];

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

            // High-Tier Code Audit for file modifications
            if (toolName === 'fs.patch' || toolName === 'fs.write') {
                const auditResult = this.auditCodeChange(params.path, params.content || params.replace);
                if (!auditResult.passed) {
                    return {
                        action: 'block',
                        reason: `Code quality audit failed: ${auditResult.issues.map(i => i.message).join(', ')}. Suggestions: ${auditResult.suggestions.join(' ')}`
                    };
                }
            }

            // 1. Check if tool is optional and not allowlisted
            if (tool.optional) {
                // For now, allow all optional tools but log it
                console.log(`[CRITIC] ⚡ Optional tool invoked: ${toolName}`);
            }

            // 2. MacOS Path & CWD Guard (Strict Block - Priority 1)
            const path = (params.path as string || "").toLowerCase();
            const cwd = (params.cwd as string || process.cwd()).toLowerCase();

            for (const protectedPath of this.PROTECTED_MAC_PATHS) {
                const expandedPath = protectedPath.replace('~', process.env.HOME || '').toLowerCase();
                if (path.startsWith(expandedPath)) {
                    return { action: 'block', reason: `Security Violation: Access to protected path "${protectedPath}" is forbidden.` };
                }
                if (cwd.startsWith(expandedPath)) {
                    return { action: 'block', reason: `Security Violation: Operations within protected directory "${protectedPath}" are denied.` };
                }
            }

            // 3. Risk-based gating (Command Analysis - Priority 2)
            const paramStr = JSON.stringify(params).toLowerCase();
            if (tool.riskLevel === 'dangerous' || toolName === 'terminal.run') {
                // Check FORBIDDEN (Immediate Block)
                for (const pattern of this.FORBIDDEN_MAC_COMMANDS) {
                    if (paramStr.includes(pattern.toLowerCase())) {
                        return { action: 'block', reason: `Strict Security Violation: Destructive command pattern "${pattern}" detected.` };
                    }
                }

                // Check Obfuscation (e.g. base64 piping)
                if (paramStr.includes('| base64') || paramStr.includes('| bash') || paramStr.includes('| sh')) {
                    return { action: 'block', reason: `Security Risk: Command obfuscation or piping to shell is forbidden for this tool.` };
                }

                // Shell Injection Detection: catch chained/escaped commands
                const injectionPatterns = [
                    /;\s*\w/,         // cmd1 ; cmd2
                    /\$\(/,           // $(subcommand)
                    /`[^`]+`/,        // `backtick subshell`
                    /\|\|\s*\w/,      // cmd1 || cmd2 (conditional chain)
                    />\s*\/(?!dev\/null)/,  // redirect to sensitive paths (but allow /dev/null)
                ];
                for (const rx of injectionPatterns) {
                    if (rx.test(paramStr)) {
                        return {
                            action: 'requireApproval',
                            reason: `Shell Injection Risk: Command contains chained/piped operations that may bypass safety checks.`,
                            approvalId: `injection-${Date.now()}-${toolName}`,
                        };
                    }
                }

                // Check HIGH RISK (Require Approval)
                for (const pattern of this.HIGH_RISK_MAC_COMMANDS) {
                    if (paramStr.includes(pattern.toLowerCase())) {
                        return {
                            action: 'requireApproval',
                            reason: `High-Risk Action Detected: "${pattern}" affects core system/network stability.`,
                            approvalId: `security-${Date.now()}-${toolName}`,
                        };
                    }
                }

                // 4. Adaptive Trust Check (Bypass gating if pattern is known safe)
                if (Date.now() < this.sessionTrustUntil) {
                    console.log(`[CRITIC] ⚡ Session Trust Active: Auto-allowing ${toolName}`);
                    return { action: 'allow' };
                }

                for (const pattern of this.trustedPatterns) {
                    if (paramStr.includes(pattern)) {
                        console.log(`[CRITIC] ⚡ Pattern Trust: Match "${pattern}", auto-allowing.`);
                        return { action: 'allow' };
                    }
                }

                // Finally, general approval for dangerous tools
                if (tool.riskLevel === 'dangerous') {
                    return {
                        action: 'requireApproval',
                        reason: `Dangerous tool "${toolName}" requires user approval.`,
                        approvalId: `risk-${Date.now()}-${toolName}`,
                    };
                }
            }

            return { action: 'allow' };
        };
    }

    /**
     * Semantically audits a code change before it is applied.
     * Enforces professional engineering standards.
     */
    public auditCodeChange(filePath: string, code: string): CriticAuditResult {
        const issues: CriticIssue[] = [];
        const suggestions: string[] = [];
        const lower = code.toLowerCase();

        // 1. Anti-Pattern Detection
        if (lower.includes('process.exit(') && !filePath.includes('daemon.ts') && !filePath.includes('test/')) {
            issues.push({ severity: 'error', category: 'quality', message: 'Unauthorized process.exit call. Use error throwing or Nexus signal system instead.' });
        }

        if (lower.includes('console.log(') && (filePath.includes('src/core/') || filePath.includes('src/shared/'))) {
            if (!lower.includes('[nexus]') && !lower.includes('[critic]') && !lower.includes('[bridge]')) {
                issues.push({ severity: 'warning', category: 'quality', message: 'Naked console.log detected in core. Use the system logger or a tagged log.' });
            }
        }

        // 2. Security / Risk Checks
        if (lower.includes('dangerouslysetinnerhtml') || lower.includes('innerHTML =')) {
            issues.push({ severity: 'error', category: 'security', message: 'XSS Risk: Direct HTML injection detected.' });
        }

        if (lower.includes('eval(') || lower.includes('new Function(')) {
            issues.push({ severity: 'error', category: 'security', message: 'Security Risk: Dynamic code execution (eval) is forbidden.' });
        }

        // 3. Resource Leak Check
        if (lower.includes('fs.watch') || lower.includes('setInterval(')) {
            if (!lower.includes('unwatch') && !lower.includes('clearInterval')) {
                issues.push({ severity: 'warning', category: 'quality', message: 'Potential resource leak: created a watcher/interval without visible cleanup logic.' });
            }
        }

        // 4. Strict Typography/Style
        if (code.includes('any') && !code.includes('as any') && filePath.includes('.ts')) {
            if (!code.includes('Record<string, any>') && !code.includes('Promise<any>')) {
                issues.push({ severity: 'warning', category: 'quality', message: 'Usage of "any" type detected. Prefer specific interfaces or unknown.' });
            }
        }

        const passed = issues.filter(i => i.severity === 'error').length === 0;

        return {
            passed,
            confidence: passed ? 1.0 : 0.5,
            issues,
            suggestions
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

        // 1. Check STRICT FORBIDDEN (Destructive)
        for (const pattern of this.FORBIDDEN_MAC_COMMANDS) {
            if (lower.includes(pattern.toLowerCase())) {
                issues.push({
                    severity: 'error',
                    category: 'security',
                    message: `Critical Security violation: "${pattern}" (Host device protection)`,
                });
            }
        }

        // 2. Check HIGH RISK (Warning)
        for (const pattern of this.HIGH_RISK_MAC_COMMANDS) {
            if (lower.includes(pattern.toLowerCase())) {
                issues.push({
                    severity: 'warning',
                    category: 'security',
                    message: `High-risk operation: "${pattern}" often requires manual approval.`,
                });
            }
        }

        // 3. Check General Destruction
        const generalDangerous = [
            { pattern: 'sudo', message: 'Elevated privileges requested' },
            { pattern: 'chmod 777', message: 'World-writable permissions' },
            { pattern: '/etc/passwd', message: 'System password file access' },
            { pattern: 'DROP TABLE', message: 'SQL destructive operation' },
        ];

        for (const { pattern, message } of generalDangerous) {
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

    /* ─── Adaptive Trust Management ─── */
    public addTrustedPattern(pattern: string): void {
        this.trustedPatterns.add(pattern.toLowerCase().trim());
        console.log(`[CRITIC] 🔐 New Trusted Pattern: "${pattern}"`);
    }

    public enableSessionTrust(minutes: number = 30): void {
        this.sessionTrustUntil = Date.now() + (minutes * 60 * 1000);
        console.log(`[CRITIC] 🔓 Session Trust Enabled for ${minutes} minutes.`);
    }

    public isSessionTrustActive(): boolean {
        return Date.now() < this.sessionTrustUntil;
    }
}

export const nexusCritic = new NexusCritic();
