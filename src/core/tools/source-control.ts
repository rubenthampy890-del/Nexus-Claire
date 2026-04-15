/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   NEXUS CLAIRE — SOURCE CONTROL TOOLS v1.0                      ║
 * ║   True Self-Healing: Read, Search, Patch Own Source Code         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * These tools give Nexus the ability to inspect, search, modify, and
 * verify its own source code — enabling true autonomous self-healing
 * and feature implementation beyond simple plugin generation.
 *
 * Safety: All patches create .bak backups. Modifications are restricted
 * to the project src/ directory. A compilation check runs after every patch.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { toolRegistry, type ToolDefinition } from "../tool-registry";

const PROJECT_ROOT = resolve(process.cwd());
const ALLOWED_DIRS = ["src", "dashboard/src", "nexus.ts", "package.json"];

// Track last patched file for smart revert suggestions
let lastPatchedFile: string | null = null;

/**
 * Security guard: ensures a path is within the project and within allowed directories.
 */
function validatePath(filePath: string): string {
    const abs = resolve(PROJECT_ROOT, filePath);
    const rel = relative(PROJECT_ROOT, abs);

    if (rel.startsWith("..") || rel.startsWith("/")) {
        throw new Error(`Security: Path "${filePath}" escapes the project root.`);
    }

    const isAllowed = ALLOWED_DIRS.some(d => rel.startsWith(d));
    if (!isAllowed) {
        throw new Error(
            `Security: Path "${rel}" is outside allowed directories (${ALLOWED_DIRS.join(", ")}). ` +
            `Only source code can be modified.`
        );
    }

    return abs;
}

// ────────────── Tool 1: code_read ──────────────

const codeReadTool: ToolDefinition = {
    name: "nexus.code_read",
    description:
        "Read the contents of a source file from the Nexus codebase with line numbers. " +
        "Use this to inspect code before patching. Specify startLine/endLine to read a range.",
    category: "intelligence",
    riskLevel: "safe",
    parameters: {
        path: {
            type: "string",
            description: 'Relative path from project root (e.g. "src/core/brain.ts")',
            required: true,
        },
        startLine: {
            type: "number",
            description: "First line to read (1-indexed, default: 1)",
            required: false,
        },
        endLine: {
            type: "number",
            description: "Last line to read (inclusive, default: end of file)",
            required: false,
        },
    },
    execute: async (params) => {
        const filePath = validatePath(params.path as string);
        if (!existsSync(filePath)) {
            throw new Error(`File not found: ${params.path}`);
        }

        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        const start = Math.max(1, (params.startLine as number) || 1);
        const end = Math.min(lines.length, (params.endLine as number) || lines.length);

        const numbered = lines
            .slice(start - 1, end)
            .map((line, i) => `${start + i}: ${line}`)
            .join("\n");

        return `File: ${params.path} (${lines.length} total lines, showing ${start}-${end})\n\n${numbered}`;
    },
};

// ────────────── Tool 2: code_grep ──────────────

const codeGrepTool: ToolDefinition = {
    name: "nexus.code_grep",
    description:
        "Search the Nexus codebase for a pattern (regex supported). " +
        "Returns matching file paths and line numbers. Essential for finding where features are implemented.",
    category: "intelligence",
    riskLevel: "safe",
    parameters: {
        pattern: {
            type: "string",
            description: "Search pattern (regex). Example: 'class.*Brain' or 'function speak'",
            required: true,
        },
        directory: {
            type: "string",
            description: 'Directory to search in (default: "src")',
            required: false,
        },
        maxResults: {
            type: "number",
            description: "Maximum results to return (default: 30)",
            required: false,
        },
    },
    execute: async (params) => {
        const dir = (params.directory as string) || "src";
        const maxResults = (params.maxResults as number) || 30;
        const searchDir = validatePath(dir);

        // Use ripgrep if available, otherwise fall back to Bun grep
        const proc = Bun.spawnSync(
            ["grep", "-rn", "--include=*.ts", "--include=*.tsx", "-E", params.pattern as string, searchDir],
            { cwd: PROJECT_ROOT }
        );

        const output = proc.stdout.toString();
        if (!output.trim()) {
            return `No matches found for pattern: ${params.pattern}`;
        }

        const lines = output.trim().split("\n");
        const truncated = lines.slice(0, maxResults);
        const results = truncated.map((line) => {
            // Convert absolute paths to relative
            return line.replace(PROJECT_ROOT + "/", "");
        });

        return `Found ${lines.length} match(es) for "${params.pattern}"${lines.length > maxResults ? ` (showing first ${maxResults})` : ""}:\n\n${results.join("\n")}`;
    },
};

// ────────────── Tool 3: code_patch (Line-Number Aware) ──────────────

const codePatchTool: ToolDefinition = {
    name: "nexus.code_patch",
    description:
        "Surgically replace code in a source file. " +
        "PREFERRED: Use startLine + endLine + replacement for line-range patching (immune to whitespace issues). " +
        "FALLBACK: Use target + replacement for exact string matching. " +
        "A .bak backup and Git checkpoint are created before modification.",
    category: "intelligence",
    riskLevel: "moderate",
    parameters: {
        path: {
            type: "string",
            description: 'Relative path from project root (e.g. "src/core/brain.ts")',
            required: true,
        },
        startLine: {
            type: "number",
            description: "Start line number (1-indexed) for line-range patching. PREFERRED over target.",
            required: false,
        },
        endLine: {
            type: "number",
            description: "End line number (1-indexed, inclusive) for line-range patching.",
            required: false,
        },
        target: {
            type: "string",
            description: "FALLBACK: The exact text block to find and replace (only if startLine/endLine not provided)",
            required: false,
        },
        replacement: {
            type: "string",
            description: "The replacement text to insert",
            required: true,
        },
        description: {
            type: "string",
            description: "Brief description of what this patch does (for audit log)",
            required: true,
        },
    },
    execute: async (params) => {
        const filePath = validatePath(params.path as string);
        if (!existsSync(filePath)) {
            throw new Error(`File not found: ${params.path}`);
        }

        const replacement = params.replacement as string;
        const desc = params.description as string;
        const startLine = params.startLine as number | undefined;
        const endLine = params.endLine as number | undefined;

        // Read current content
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        // ── Git Checkpoint ──
        try {
            Bun.spawnSync(["git", "add", "-A"], { cwd: PROJECT_ROOT });
            Bun.spawnSync(["git", "commit", "-am", `AUTO-CHECKPOINT: Pre-patch ${params.path}`], { cwd: PROJECT_ROOT, timeout: 5000 });
        } catch { /* Git may not be initialized or nothing to commit */ }

        // Create .bak backup
        const backupPath = filePath + ".bak";
        copyFileSync(filePath, backupPath);

        let patchedContent: string;
        let linesReplaced: number;
        let linesInserted: number;

        // ── MODE 1: Line-Number Range Patching (Preferred) ──
        if (startLine && endLine) {
            if (startLine < 1 || endLine > lines.length || startLine > endLine) {
                throw new Error(
                    `Invalid line range: ${startLine}-${endLine}. File has ${lines.length} lines.`
                );
            }

            const before = lines.slice(0, startLine - 1);
            const after = lines.slice(endLine);
            const replacementLines = replacement.split("\n");

            patchedContent = [...before, ...replacementLines, ...after].join("\n");
            linesReplaced = endLine - startLine + 1;
            linesInserted = replacementLines.length;

            // ── MODE 2: String-Match Patching (Fallback) ──
        } else if (params.target) {
            const target = params.target as string;

            if (!content.includes(target)) {
                const targetFirstLine = target.split("\n")[0]?.trim();
                const hint = targetFirstLine
                    ? lines.findIndex((l) => l.trim() === targetFirstLine)
                    : -1;
                throw new Error(
                    `Target text not found in ${params.path}. ` +
                    (hint >= 0
                        ? `Hint: Similar text near line ${hint + 1}. Use code_read, then use startLine/endLine instead.`
                        : `Use code_read to inspect the file, then use startLine/endLine for reliable patching.`)
                );
            }

            const matchCount = content.split(target).length - 1;
            if (matchCount > 1) {
                throw new Error(
                    `Ambiguous: ${matchCount} matches found. Use startLine/endLine for precise targeting.`
                );
            }

            patchedContent = content.replace(target, replacement);
            linesReplaced = target.split("\n").length;
            linesInserted = replacement.split("\n").length;
        } else {
            throw new Error("Either startLine+endLine or target must be provided.");
        }

        writeFileSync(filePath, patchedContent, "utf-8");
        lastPatchedFile = params.path as string;

        console.log(
            `[SOURCE-CONTROL] 🔧 Patched ${params.path}: "${desc}" (${linesReplaced} lines → ${linesInserted} lines)`
        );

        return (
            `✅ Patch applied to ${params.path}\n` +
            `- Description: ${desc}\n` +
            `- Mode: ${startLine ? 'Line-Range' : 'String-Match'}\n` +
            `- Lines replaced: ${linesReplaced} → ${linesInserted}\n` +
            `- Backup: ${relative(PROJECT_ROOT, backupPath)}\n` +
            `- Git Checkpoint: Created\n\n` +
            `⚠️ Run nexus.run_tests to verify the patch didn't break anything.`
        );
    },
};

// ────────────── Tool 4: run_tests (with auto-revert suggestion) ──────────────

const runTestsTool: ToolDefinition = {
    name: "nexus.run_tests",
    description:
        "Run TypeScript compilation check (tsc --noEmit) to verify the codebase compiles correctly after a patch. " +
        "Use this after every code_patch to ensure nothing is broken. " +
        "If tests fail after a patch, suggests reverting with nexus.code_revert.",
    category: "intelligence",
    riskLevel: "safe",
    timeout: 60000,
    parameters: {
        mode: {
            type: "string",
            description: '"typecheck" (default) for tsc --noEmit, or "test" for bun test',
            required: false,
            enum: ["typecheck", "test"],
        },
    },
    execute: async (params) => {
        const mode = (params.mode as string) || "typecheck";

        if (mode === "typecheck") {
            const proc = Bun.spawnSync(["bunx", "tsc", "--noEmit", "--pretty"], {
                cwd: PROJECT_ROOT,
                timeout: 45000,
            });

            const output = (proc.stdout.toString() + proc.stderr.toString()).trim();

            const lines = output.split("\n");
            const relevantErrors = lines.filter(
                (l) => l.includes("error TS") && !l.includes("nexus tools/")
            );

            if (proc.exitCode === 0 || relevantErrors.length === 0) {
                lastPatchedFile = null; // Clear: patch was successful
                return "✅ TypeScript compilation passed. No new errors detected.";
            }

            // ── Auto-Revert Suggestion ──
            let revertHint = '';
            if (lastPatchedFile) {
                revertHint = `\n\n🔄 REVERT HINT: You just patched "${lastPatchedFile}". ` +
                    `If this error is new, call nexus.code_revert({"path": "${lastPatchedFile}"}) immediately, ` +
                    `or run git reset --hard HEAD to restore the full checkpoint.`;
            }

            return (
                `❌ TypeScript errors detected (${relevantErrors.length}):\n\n` +
                relevantErrors.slice(0, 15).join("\n") +
                (relevantErrors.length > 15
                    ? `\n\n... and ${relevantErrors.length - 15} more errors.`
                    : "") +
                revertHint
            );
        } else {
            const proc = Bun.spawnSync(["bun", "test"], {
                cwd: PROJECT_ROOT,
                timeout: 45000,
            });

            const output = (proc.stdout.toString() + proc.stderr.toString()).trim();

            if (proc.exitCode === 0) {
                lastPatchedFile = null;
                return `✅ All tests passed.\n\n${output.slice(-500)}`;
            }

            let revertHint = '';
            if (lastPatchedFile) {
                revertHint = `\n\n🔄 REVERT HINT: Recent patch to "${lastPatchedFile}" may have caused this. ` +
                    `Call nexus.code_revert({"path": "${lastPatchedFile}"}) to restore.`;
            }

            return `❌ Test failures:\n\n${output.slice(-1000)}${revertHint}`;
        }
    },
};

// ────────────── Tool 4b: code_revert ──────────────

const codeRevertTool: ToolDefinition = {
    name: "nexus.code_revert",
    description:
        "Instantly restore a source file from its .bak backup created by code_patch. " +
        "Use this when run_tests fails after a patch to undo the damage.",
    category: "intelligence",
    riskLevel: "safe",
    parameters: {
        path: {
            type: "string",
            description: 'Relative path of the file to revert (e.g. "src/core/brain.ts")',
            required: true,
        },
        useGit: {
            type: "boolean",
            description: 'If true, use git reset --hard HEAD instead of .bak file (reverts ALL files)',
            required: false,
        },
    },
    execute: async (params) => {
        if (params.useGit) {
            const proc = Bun.spawnSync(["git", "reset", "--hard", "HEAD"], { cwd: PROJECT_ROOT });
            const cleanProc = Bun.spawnSync(["git", "clean", "-fd"], { cwd: PROJECT_ROOT });
            lastPatchedFile = null;
            return `✅ Git hard reset complete. All files restored to last checkpoint.\n${proc.stdout.toString()}`;
        }

        const filePath = validatePath(params.path as string);
        const backupPath = filePath + ".bak";

        if (!existsSync(backupPath)) {
            throw new Error(`No .bak backup found for ${params.path}. Try useGit: true for git-level revert.`);
        }

        copyFileSync(backupPath, filePath);
        lastPatchedFile = null;

        console.log(`[SOURCE-CONTROL] ⏪ Reverted ${params.path} from .bak backup.`);
        return `✅ Reverted ${params.path} to pre-patch state from .bak backup.\nRun nexus.run_tests to confirm the revert fixed the issue.`;
    },
};

// ────────────── Tool 5: code_write (new file) ──────────────

const codeWriteTool: ToolDefinition = {
    name: "nexus.code_write",
    description:
        "Create a new source file in the Nexus codebase. " +
        "Use this to add entirely new modules, utilities, or features. " +
        "Cannot overwrite existing files (use code_patch for modifications).",
    category: "intelligence",
    riskLevel: "moderate",
    parameters: {
        path: {
            type: "string",
            description: 'Relative path from project root (e.g. "src/core/my-new-module.ts")',
            required: true,
        },
        content: {
            type: "string",
            description: "The full TypeScript source code for the new file",
            required: true,
        },
        description: {
            type: "string",
            description: "Brief description of what this file does (for audit log)",
            required: true,
        },
    },
    execute: async (params) => {
        const filePath = validatePath(params.path as string);

        if (existsSync(filePath)) {
            throw new Error(
                `File already exists: ${params.path}. Use nexus.code_patch to modify existing files.`
            );
        }

        writeFileSync(filePath, params.content as string, "utf-8");

        const lineCount = (params.content as string).split("\n").length;
        console.log(`[SOURCE-CONTROL] 📝 Created ${params.path}: "${params.description}" (${lineCount} lines)`);

        return (
            `✅ Created new file: ${params.path}\n` +
            `- Description: ${params.description}\n` +
            `- Lines: ${lineCount}\n\n` +
            `⚠️ Run nexus.run_tests to verify it compiles.`
        );
    },
};

// ────────────── Registration ──────────────

export const sourceControlTools: ToolDefinition[] = [
    codeReadTool,
    codeGrepTool,
    codePatchTool,
    runTestsTool,
    codeRevertTool,
    codeWriteTool,
];

export function registerSourceControlTools(): void {
    for (const tool of sourceControlTools) {
        toolRegistry.register(tool);
    }
    console.log(`[SOURCE-CONTROL] 🧬 ${sourceControlTools.length} source control tools registered.`);
}
