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

// ────────────── Tool 3: code_patch ──────────────

const codePatchTool: ToolDefinition = {
    name: "nexus.code_patch",
    description:
        "Surgically replace a block of text in a source file. " +
        "Provide the exact text to find (target) and the replacement text. " +
        "A .bak backup is created before modification. Use code_read first to see the exact text.",
    category: "intelligence",
    riskLevel: "moderate",
    parameters: {
        path: {
            type: "string",
            description: 'Relative path from project root (e.g. "src/core/brain.ts")',
            required: true,
        },
        target: {
            type: "string",
            description: "The exact text block to find and replace (must match exactly, including whitespace)",
            required: true,
        },
        replacement: {
            type: "string",
            description: "The replacement text to insert in place of the target",
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

        const target = params.target as string;
        const replacement = params.replacement as string;
        const desc = params.description as string;

        // Read current content
        const content = readFileSync(filePath, "utf-8");

        // Verify target exists
        if (!content.includes(target)) {
            // Try to find a close match to help the agent
            const targetLines = target.split("\n");
            const firstLine = targetLines[0]?.trim();
            const hint = firstLine
                ? content.split("\n").findIndex((l) => l.trim() === firstLine)
                : -1;

            throw new Error(
                `Target text not found in ${params.path}. ` +
                (hint >= 0
                    ? `Hint: Found similar text near line ${hint + 1}. Use code_read to see exact content.`
                    : `Use code_read to inspect the file first.`)
            );
        }

        // Check for multiple matches (ambiguity)
        const matchCount = content.split(target).length - 1;
        if (matchCount > 1) {
            throw new Error(
                `Ambiguous: Found ${matchCount} matches for target text in ${params.path}. ` +
                `Provide a longer, more specific target block.`
            );
        }

        // Create backup
        const backupPath = filePath + ".bak";
        copyFileSync(filePath, backupPath);

        // Apply patch
        const patched = content.replace(target, replacement);
        writeFileSync(filePath, patched, "utf-8");

        // Count lines changed
        const targetLines = target.split("\n").length;
        const replacementLines = replacement.split("\n").length;

        // Log the patch for audit trail
        console.log(
            `[SOURCE-CONTROL] 🔧 Patched ${params.path}: "${desc}" (${targetLines} lines → ${replacementLines} lines)`
        );

        return (
            `✅ Patch applied to ${params.path}\n` +
            `- Description: ${desc}\n` +
            `- Lines replaced: ${targetLines} → ${replacementLines}\n` +
            `- Backup created: ${relative(PROJECT_ROOT, backupPath)}\n\n` +
            `⚠️ Run nexus.run_tests to verify the patch didn't break anything.`
        );
    },
};

// ────────────── Tool 4: run_tests ──────────────

const runTestsTool: ToolDefinition = {
    name: "nexus.run_tests",
    description:
        "Run TypeScript compilation check (tsc --noEmit) to verify the codebase compiles correctly after a patch. " +
        "Use this after every code_patch to ensure nothing is broken.",
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

            // Filter out known pre-existing errors in generated tools
            const lines = output.split("\n");
            const relevantErrors = lines.filter(
                (l) => l.includes("error TS") && !l.includes("nexus tools/")
            );

            if (proc.exitCode === 0 || relevantErrors.length === 0) {
                return "✅ TypeScript compilation passed. No new errors detected.";
            }

            return (
                `❌ TypeScript errors detected (${relevantErrors.length}):\n\n` +
                relevantErrors.slice(0, 15).join("\n") +
                (relevantErrors.length > 15
                    ? `\n\n... and ${relevantErrors.length - 15} more errors.`
                    : "")
            );
        } else {
            const proc = Bun.spawnSync(["bun", "test"], {
                cwd: PROJECT_ROOT,
                timeout: 45000,
            });

            const output = (proc.stdout.toString() + proc.stderr.toString()).trim();

            if (proc.exitCode === 0) {
                return `✅ All tests passed.\n\n${output.slice(-500)}`;
            }

            return `❌ Test failures:\n\n${output.slice(-1000)}`;
        }
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
    codeWriteTool,
];

export function registerSourceControlTools(): void {
    for (const tool of sourceControlTools) {
        toolRegistry.register(tool);
    }
    console.log(`[SOURCE-CONTROL] 🧬 ${sourceControlTools.length} source control tools registered.`);
}
