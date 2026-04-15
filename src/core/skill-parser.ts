/**
 * Nexus Skill Parser: Watches a directory for SKILL.md files and dynamically
 * injects learnt knowledge and tools into the Architect's system prompt.
 *
 * Skills Directory: /Users/basilthampy/Music/antigravity/new automative ai/skills
 *
 * Format: Each skill is a folder containing at minimum a SKILL.md file with
 * YAML frontmatter (name, description) and markdown instructions.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { NexusCLI } from "./cli-ui";

export interface ParsedSkill {
    name: string;
    description: string;
    instructions: string;
    path: string;
    loadedAt: number;
}

const SKILLS_DIR = "/Users/basilthampy/Music/antigravity/new automative ai/skills";

class SkillParserService {
    private skills: Map<string, ParsedSkill> = new Map();
    private watchInterval: NodeJS.Timeout | null = null;

    /**
     * Boot: Scan the skills directory and load all SKILL.md files.
     */
    public async initialize() {
        // Ensure directory exists
        if (!fs.existsSync(SKILLS_DIR)) {
            fs.mkdirSync(SKILLS_DIR, { recursive: true });
            console.log(`[SKILL PARSER] Created skills directory: ${SKILLS_DIR}`);
        }

        // Initial scan
        await this.scanSkills();

        // Watch for changes every 30 seconds
        this.watchInterval = setInterval(() => this.scanSkills(), 30000);

        NexusCLI.showStatus("Skill Parser", `${this.skills.size} skill(s) loaded`, "#FF9900");
    }

    /**
     * Scan the skills directory for SKILL.md files.
     * Each subdirectory with a SKILL.md file is treated as a skill.
     */
    private async scanSkills() {
        try {
            if (!fs.existsSync(SKILLS_DIR)) return;

            const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });

            for (const entry of entries) {
                // Check for directories containing SKILL.md
                if (entry.isDirectory()) {
                    const skillMdPath = path.join(SKILLS_DIR, entry.name, "SKILL.md");
                    if (fs.existsSync(skillMdPath)) {
                        this.loadSkill(skillMdPath, entry.name);
                    }
                }

                // Also check for standalone .md files at root level
                if (entry.isFile() && entry.name.endsWith('.md')) {
                    const skillPath = path.join(SKILLS_DIR, entry.name);
                    this.loadSkill(skillPath, entry.name.replace('.md', ''));
                }
            }
        } catch (err: any) {
            NexusCLI.quietLog(`[SKILL PARSER] Scan error: ${err.message}`);
        }
    }

    /**
     * Parse a SKILL.md file with YAML frontmatter.
     */
    private loadSkill(filePath: string, fallbackName: string) {
        try {
            const content = fs.readFileSync(filePath, "utf-8");

            // Parse YAML frontmatter
            let name = fallbackName;
            let description = "";
            let instructions = content;

            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
            if (frontmatterMatch) {
                const yaml = frontmatterMatch[1] || "";
                instructions = frontmatterMatch[2] || "";

                // Simple YAML parser for name/description
                const nameMatch = yaml.match(/name:\s*(.+)/);
                const descMatch = yaml.match(/description:\s*(.+)/);
                if (nameMatch && nameMatch[1]) name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
                if (descMatch && descMatch[1]) description = descMatch[1].trim().replace(/^["']|["']$/g, '');
            }

            const existingSkill = this.skills.get(name);
            const stat = fs.statSync(filePath);

            // Skip if already loaded and file hasn't changed
            if (existingSkill && existingSkill.loadedAt >= stat.mtimeMs) return;

            const skill: ParsedSkill = {
                name,
                description,
                instructions: instructions.trim(),
                path: filePath,
                loadedAt: stat.mtimeMs,
            };

            this.skills.set(name, skill);

            if (!existingSkill) {
                console.log(`[SKILL PARSER] ✅ Loaded skill: "${name}" from ${filePath}`);
            } else {
                console.log(`[SKILL PARSER] 🔄 Hot-reloaded skill: "${name}"`);
            }
        } catch (err: any) {
            NexusCLI.quietLog(`[SKILL PARSER] Failed to load ${filePath}: ${err.message}`);
        }
    }

    /**
     * Get all loaded skills as a formatted context string for system prompt injection.
     */
    public getSkillContext(): string {
        if (this.skills.size === 0) return "";

        let context = "\n\n=== LEARNED SKILLS ===\n";
        for (const [name, skill] of this.skills) {
            context += `\n[SKILL: ${name}]`;
            if (skill.description) context += ` — ${skill.description}`;
            context += `\n${skill.instructions}\n`;
        }
        context += "\n=== END SKILLS ===\n";

        return context;
    }

    /**
     * Get all loaded skills as an array (for dashboard display).
     */
    public getAllSkills(): ParsedSkill[] {
        return Array.from(this.skills.values());
    }

    /**
     * Get the count of currently loaded skills.
     */
    public getSkillCount(): number {
        return this.skills.size;
    }

    /**
     * Force a manual reload of all skills.
     */
    public async reload() {
        this.skills.clear();
        await this.scanSkills();
        return this.skills.size;
    }

    public stop() {
        if (this.watchInterval) {
            clearInterval(this.watchInterval);
            this.watchInterval = null;
        }
    }
}

export const skillParser = new SkillParserService();
