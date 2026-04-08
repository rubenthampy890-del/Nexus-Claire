/**
 * ╔══════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — SKILL ENGINE v1.0               ║
 * ║       Persistent Learned Capabilities                ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * The Skill Engine gives Nexus the ability to:
 *   1. Load skill definitions from disk (Markdown/YAML)
 *   2. Match relevant skills to a user's query
 *   3. Learn & persist NEW skills at runtime
 *   4. Hot-reload when files change
 *
 * Skills are stored in two locations:
 *   - Built-in: .agents/skills/  (read-only, curated)
 *   - Learned:  learned-skills/  (read-write, runtime)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, watch } from "node:fs";
import { join, basename, extname } from "node:path";
import { inference } from "./inference";
import { toolFactory, type ToolSpec } from "./tool-factory";

export interface Skill {
    id: string;
    name: string;
    description: string;
    triggers: string[];       // Keywords that activate this skill
    context: string;          // Injected into system prompt when active
    examples?: string[];      // Example usage patterns
    source: 'builtin' | 'learned';
    lastUsed?: number;
    useCount: number;
}

export class NexusSkillEngine {
    private skills: Map<string, Skill> = new Map();
    private activeSkills: Set<string> = new Set();

    private builtinDir: string;
    private learnedDir: string;

    constructor() {
        this.builtinDir = join(process.cwd(), ".agents", "skills");
        this.learnedDir = join(process.cwd(), "learned-skills");

        // Ensure learned-skills directory exists
        if (!existsSync(this.learnedDir)) {
            mkdirSync(this.learnedDir, { recursive: true });
        }
    }

    /**
     * Boot: Load all skills from both directories.
     */
    public async initialize(): Promise<void> {
        console.log("[SKILL ENGINE] Initializing...");

        // Load built-in skills (top-level .md files only, not subdirectories)
        this.loadSkillsFromDir(this.builtinDir, 'builtin');

        // Load learned skills
        this.loadSkillsFromDir(this.learnedDir, 'learned');

        console.log(`[SKILL ENGINE] Loaded ${this.skills.size} skills (${this.getLearnedCount()} learned).`);

        // Watch learned-skills for hot-reload
        this.watchForChanges();
    }

    /**
     * Load Markdown skill files from a directory.
     * Expects files with YAML frontmatter or simple Markdown format.
     */
    private loadSkillsFromDir(dir: string, source: 'builtin' | 'learned'): void {
        if (!existsSync(dir)) return;

        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.yaml'))) {
                try {
                    const filePath = join(dir, entry.name);
                    const content = readFileSync(filePath, 'utf8');
                    const skill = this.parseSkillFile(entry.name, content, source);
                    if (skill) {
                        this.skills.set(skill.id, skill);
                    }
                } catch (e: any) {
                    console.warn(`[SKILL ENGINE] Failed to load ${entry.name}: ${e.message}`);
                }
            } else if (entry.isDirectory()) {
                // Check for SKILL.md inside subdirectories (standard skill pack format)
                const skillMd = join(dir, entry.name, 'SKILL.md');
                if (existsSync(skillMd)) {
                    try {
                        const content = readFileSync(skillMd, 'utf8');
                        const skill = this.parseSkillFile(entry.name, content, source);
                        if (skill) {
                            this.skills.set(skill.id, skill);
                        }
                    } catch (e: any) {
                        console.warn(`[SKILL ENGINE] Failed to load ${entry.name}/SKILL.md: ${e.message}`);
                    }
                }
            }
        }
    }

    /**
     * Parse a Markdown/YAML skill file into a Skill object.
     * Supports YAML frontmatter (---) and plain Markdown.
     */
    private parseSkillFile(filename: string, content: string, source: 'builtin' | 'learned'): Skill | null {
        const id = basename(filename, extname(filename)).toLowerCase().replace(/\s+/g, '-');

        // Try to parse YAML frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

        let name = id;
        let description = '';
        let triggers: string[] = [];
        let examples: string[] = [];
        let body = content;

        if (frontmatterMatch) {
            const yaml = frontmatterMatch[1]!;
            body = frontmatterMatch[2]!;

            // Simple YAML parsing for key fields
            const nameMatch = yaml.match(/name:\s*(.+)/);
            const descMatch = yaml.match(/description:\s*(.+)/);
            const triggerMatch = yaml.match(/triggers:\s*\[(.+)\]/);

            if (nameMatch) name = nameMatch[1]!.trim().replace(/['"]/g, '');
            if (descMatch) description = descMatch[1]!.trim().replace(/['"]/g, '');
            if (triggerMatch) {
                triggers = triggerMatch[1]!.split(',').map(t => t.trim().toLowerCase().replace(/['"]/g, ''));
            }
        }

        // Auto-generate triggers from the skill name if none provided
        if (triggers.length === 0) {
            triggers = id.split('-').filter(w => w.length > 2);
        }

        // Use the first 500 chars of body as context
        const context = body.trim().substring(0, 1500);

        return {
            id,
            name,
            description: description || `Skill: ${name}`,
            triggers,
            context,
            examples,
            source,
            useCount: 0,
        };
    }

    /**
     * Find relevant skills for a user query.
     * Returns skills whose triggers match keywords in the query.
     */
    public matchSkills(query: string): Skill[] {
        const lower = query.toLowerCase();
        const matched: Skill[] = [];

        for (const skill of this.skills.values()) {
            const score = skill.triggers.reduce((acc, trigger) => {
                return acc + (lower.includes(trigger) ? 1 : 0);
            }, 0);

            if (score > 0) {
                matched.push(skill);
            }
        }

        // Sort by relevance (trigger match count)
        return matched.sort((a, b) => {
            const scoreA = a.triggers.filter(t => lower.includes(t)).length;
            const scoreB = b.triggers.filter(t => lower.includes(t)).length;
            return scoreB - scoreA;
        }).slice(0, 3); // Max 3 skills per query
    }

    /**
     * Generate a prompt injection block for matched skills.
     * Called by identity.ts to augment the system prompt.
     */
    public getSkillContext(query: string): string {
        const matched = this.matchSkills(query);
        if (matched.length === 0) return '';

        // Track usage
        for (const skill of matched) {
            skill.useCount++;
            skill.lastUsed = Date.now();
        }
        this.activeSkills = new Set(matched.map(s => s.id));

        const blocks = matched.map(s =>
            `[SKILL: ${s.name}]\n${s.context.substring(0, 500)}`
        );

        return `\nACTIVE SKILLS (specialized knowledge for this query):\n${blocks.join('\n\n')}`;
    }

    /**
     * Context-Scoped Injection (OpenClaw pattern)
     * Returns only the single most relevant skill to avoid prompt bloat.
     */
    public getBestSkillContext(query: string): string {
        const matched = this.matchSkills(query);
        if (matched.length === 0) return '';

        // Pick the single most relevant active skill (already sorted)
        const bestSkill = matched[0]!;

        bestSkill.useCount++;
        bestSkill.lastUsed = Date.now();
        this.activeSkills = new Set([bestSkill.id]);

        return `\nACTIVE SKILL (specialized knowledge for this query):\n[SKILL: ${bestSkill.name}]\n${bestSkill.context.substring(0, 800)}`;
    }

    /**
     * Self-Authoring Engine: Scans past interactions to detect missing capabilities,
     * then uses the Inference Swarm to author and register a new tool dynamically.
     */
    public async analyzeAndAuthor(recentConversations: string[]): Promise<boolean> {
        console.log(`[SKILL ENGINE] 🧠 Analyzing ${recentConversations.length} recent interactions for missing capabilities...`);

        if (recentConversations.length < 3) return false;

        const analysisPrompt = `Analyze these recent user requests. Identify if there is a recurring task or capability the user wants that we currently lack. If there is a clear pattern (e.g. asking for weather 3 times, asking to hash strings twice), output a JSON ToolSpec to solve it. If no clear missing capability exists, output exactly "NONE".

Recent requests:
${recentConversations.slice(-10).map((r, i) => `${i + 1}. ${r}`).join('\n')}

ToolSpec JSON Format:
{
  "name": "lowercase_name_with_underscores",
  "description": "What the tool does (min 10 chars)",
  "category": "custom",
  "parameters": {
    "param1": { "type": "string", "description": "Param description", "required": true }
  },
  "logic": {
    "type": "shell_command",
    "command": "echo 'dummy command using {{param1}}'"
  },
  "triggers": ["keyword1", "keyword2"]
}

Output ONLY the JSON or "NONE".`;

        try {
            const result = await inference.chat([{ role: 'user', content: analysisPrompt }]);
            const responseText = result.trim();

            if (responseText === 'NONE' || !responseText.startsWith('{')) {
                console.log(`[SKILL ENGINE] No new capabilities needed at this time.`);
                return false;
            }

            // Extract JSON from potential markdown blocks
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return false;

            const spec: ToolSpec = JSON.parse(jsonMatch[0]);
            console.log(`[SKILL ENGINE] ✨ Architect designed a new tool: ${spec.name}`);

            const createResult = toolFactory.createFromSpec(spec);
            if (createResult.success) {
                console.log(`[SKILL ENGINE] 🚀 Successfully authored and deployed learned tool: ${spec.name}`);
                return true;
            } else {
                console.warn(`[SKILL ENGINE] ⚠️ Failed to deploy authored tool:`, createResult.errors);
                return false;
            }
        } catch (e: any) {
            console.error(`[SKILL ENGINE] Error during self-authoring: ${e.message}`);
            return false;
        }
    }

    /**
     * Learn a new skill at runtime.
     * Persists to the learned-skills directory.
     */
    public learnSkill(name: string, description: string, triggers: string[], context: string): Skill {
        const id = name.toLowerCase().replace(/\s+/g, '-');

        const skill: Skill = {
            id,
            name,
            description,
            triggers,
            context,
            source: 'learned',
            useCount: 0,
        };

        this.skills.set(id, skill);

        // Persist to disk
        const fileContent = `---
name: ${name}
description: ${description}
triggers: [${triggers.join(', ')}]
---

${context}
`;
        const filePath = join(this.learnedDir, `${id}.md`);
        writeFileSync(filePath, fileContent, 'utf8');

        console.log(`[SKILL ENGINE] 🧬 Learned new skill: "${name}" (${triggers.length} triggers)`);
        return skill;
    }

    /**
     * Watch learned-skills directory for external changes.
     */
    private watchForChanges(): void {
        try {
            watch(this.learnedDir, (eventType, filename) => {
                if (filename && (filename.endsWith('.md') || filename.endsWith('.yaml'))) {
                    console.log(`[SKILL ENGINE] Detected change: ${filename}, reloading...`);
                    this.skills.clear();
                    this.loadSkillsFromDir(this.builtinDir, 'builtin');
                    this.loadSkillsFromDir(this.learnedDir, 'learned');
                    console.log(`[SKILL ENGINE] Reloaded: ${this.skills.size} skills.`);
                }
            });
        } catch (e) {
            // fs.watch can fail in some environments (Docker, etc.)
        }
    }

    // ─── Getters ───
    public getAll(): Skill[] { return Array.from(this.skills.values()); }
    public getActive(): string[] { return Array.from(this.activeSkills); }
    public getLearnedCount(): number { return Array.from(this.skills.values()).filter(s => s.source === 'learned').length; }
    public getSkillById(id: string): Skill | undefined { return this.skills.get(id); }
}

export const skillEngine = new NexusSkillEngine();
