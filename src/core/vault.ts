import { Database } from "bun:sqlite";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";

export interface VaultFact {
    id: number;
    entity: string;
    fact: string;
    relevance: number; // 0-1
    timestamp: string;
    metadata?: any;
    similarity?: number; // for semantic search
}

export class NexusVault {
    private db: Database;
    private supabase: SupabaseClient | null = null;
    private geminiClient: GoogleGenAI;
    private vaultPath: string;
    private isSyncing: boolean = false;

    public setVaultPath(p: string) {
        this.vaultPath = p;
        if (!fs.existsSync(this.vaultPath)) {
            fs.mkdirSync(this.vaultPath, { recursive: true });
        }
        console.log(`[VAULT] Vault path updated to: ${this.vaultPath}`);
    }

    constructor(dbPath: string = "nexus.db") {
        this.db = new Database(dbPath);
        this.initializeLocal();

        this.vaultPath = process.env.OBSIDIAN_VAULT_PATH || path.join(process.cwd(), "vault");
        if (!fs.existsSync(this.vaultPath)) {
            fs.mkdirSync(this.vaultPath, { recursive: true });
            console.log(`[VAULT] Initialized new Obsidian Vault at: ${this.vaultPath}`);
        }

        const geminiKey = process.env.GEMINI_API_KEY || "";
        this.geminiClient = new GoogleGenAI({ apiKey: geminiKey });

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (supabaseUrl && supabaseKey) {
            this.supabase = createClient(supabaseUrl, supabaseKey);
            console.log("[VAULT] Supabase LTM Layer Active.");
            // Start cloud sync in background (don't block constructor)
            this.cloudPullOnBoot().catch(e => console.warn(`[VAULT] Cloud pull skipped: ${e.message}`));
        } else {
            console.warn("[VAULT] Supabase credentials missing. Long-term memory will be local-only.");
        }
    }

    /**
     * Cloud-Pull on Boot: Syncs facts from Supabase → local SQLite.
     * Runs once at startup to ensure local DB has the latest cloud knowledge.
     */
    private async cloudPullOnBoot(): Promise<void> {
        if (!this.supabase) return;

        try {
            console.log("[VAULT] ☁️ Cloud Pull: Fetching facts from Supabase...");
            const { data, error } = await this.supabase
                .from('facts')
                .select('entity, content, metadata')
                .order('created_at', { ascending: false })
                .limit(500);

            if (error) {
                console.warn(`[VAULT] Cloud pull error: ${error.message}`);
                return;
            }

            if (!data || data.length === 0) {
                console.log("[VAULT] ☁️ Cloud Pull: No cloud facts to sync.");
                return;
            }

            let imported = 0;
            for (const row of data) {
                const entity = row.entity || 'Unknown';
                const fact = row.content || '';
                if (!fact) continue;

                // Check if already exists locally (de-duplicate)
                const existing = this.db.query(
                    "SELECT id FROM facts WHERE entity = ? AND fact = ?"
                ).get(entity, fact);

                if (!existing) {
                    this.db.run(
                        "INSERT INTO facts (entity, fact, relevance) VALUES (?, ?, ?)",
                        [entity, fact, 0.8]
                    );
                    imported++;
                }
            }

            console.log(`[VAULT] ☁️ Cloud Pull Complete: ${imported} new facts imported from ${data.length} cloud records.`);
        } catch (e: any) {
            console.warn(`[VAULT] Cloud pull failed: ${e.message}`);
        }
    }

    private initializeLocal() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity TEXT,
                fact TEXT,
                relevance REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS entities (
                name TEXT PRIMARY KEY,
                type TEXT,
                description TEXT,
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Knowledge Graph Edges
        this.db.run(`
            CREATE TABLE IF NOT EXISTS relations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id TEXT,
                relation_type TEXT,
                target_id TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(source_id, relation_type, target_id)
            );
        `);

        // Initialize Creator Profile if it doesn't exist
        this.db.run(`
            INSERT OR IGNORE INTO entities (name, type, description)
            VALUES ('Ruben', 'CREATOR', 'The Architect and High Authority of Nexus Claire.');
        `);
    }

    private async generateEmbedding(text: string): Promise<number[]> {
        try {
            const response = await this.geminiClient.models.embedContent({
                model: "text-embedding-004",
                contents: text
            });
            return response.embeddings?.[0]?.values || [];
        } catch (err) {
            console.error("[VAULT] Embedding failed:", err);
            return [];
        }
    }

    public async storeFact(entity: string, fact: string, relevance: number = 1.0, metadata: any = {}) {
        // 1. Store Locally (SQL Layer) — always succeeds
        try {
            this.db.run(
                "INSERT INTO facts (entity, fact, relevance) VALUES (?, ?, ?)",
                [entity, fact, relevance]
            );
            console.log(`[VAULT] Fact stored locally: ${fact.substring(0, 80)}`);
        } catch (e: any) {
            console.error(`[VAULT] Local store error: ${e?.message}`);
        }

        // 2. Sync to Supabase (Vector Layer) — best-effort, never crashes
        if (this.supabase) {
            try {
                const embedding = await this.generateEmbedding(fact);
                if (embedding.length > 0) {
                    const { error } = await this.supabase
                        .from('facts')
                        .insert({
                            entity,
                            content: fact,
                            embedding,
                            metadata
                        });

                    if (error) console.error("[VAULT] Supabase sync error:", error.message);
                    else console.log(`[VAULT] Fact synced to Cloud: ${fact.substring(0, 60)}`);
                }
            } catch (e: any) {
                // Embedding or Supabase failure — silently continue
                console.warn(`[VAULT] Cloud sync skipped (${e?.message || 'unknown'})`);
            }
        }
    }

    public async semanticSearch(query: string, limit: number = 5): Promise<VaultFact[]> {
        if (!this.supabase) return [];

        const embedding = await this.generateEmbedding(query);
        if (embedding.length === 0) return [];

        const { data, error } = await this.supabase.rpc('match_facts', {
            query_embedding: embedding,
            match_threshold: 0.5,
            match_count: limit
        });

        if (error) {
            console.error("[VAULT] Semantic search error:", error.message);
            return [];
        }

        return (data || []).map((row: any) => ({
            id: row.id,
            entity: row.entity,
            fact: row.content,
            relevance: row.similarity,
            timestamp: new Date().toISOString(),
            similarity: row.similarity
        }));
    }

    public async getFactsForEntity(entity: string): Promise<VaultFact[]> {
        const results = this.db.query("SELECT * FROM facts WHERE entity = ? ORDER BY timestamp DESC LIMIT 5").all(entity);
        return results as VaultFact[];
    }

    public async searchFacts(query: string): Promise<VaultFact[]> {
        // Local keyword search
        const localResults = this.db.query("SELECT * FROM facts WHERE fact LIKE ? OR entity LIKE ? ORDER BY timestamp DESC LIMIT 5").all(`%${query}%`, `%${query}%`) as VaultFact[];
        return localResults;
    }

    public async getAllFacts(): Promise<VaultFact[]> {
        const results = this.db.query("SELECT * FROM facts ORDER BY timestamp DESC").all();
        return results as VaultFact[];
    }

    /**
     * The Heart of Nexus Memory: Hybrid Context Retrieval
     */
    public async getContextForPrompt(query: string): Promise<string> {
        console.log(`[VAULT] Retrieving context for: "${query.substring(0, 30)}..."`);

        // Parallel retrieval: Semantic + Keyword
        const [semantic, keyword] = await Promise.all([
            this.semanticSearch(query, 5),
            this.searchFacts(query)
        ]);

        // Merge and de-duplicate by fact content
        const seen = new Set();
        const merged: VaultFact[] = [];

        [...semantic, ...keyword].forEach(f => {
            if (!seen.has(f.fact.toLowerCase().trim())) {
                seen.add(f.fact.toLowerCase().trim());
                merged.push(f);
            }
        });

        if (merged.length === 0) return "";

        return "Relevant Nexus Memory (Semantic + Structured):\n" +
            merged.map(f => `- ${f.fact}${f.similarity ? ` [Relevance: ${Math.round(f.similarity * 100)}%]` : ''}`).join("\n");
    }

    // ──────────── Obsidian / Markdown Sync ────────────

    /**
     * Exports all facts to Markdown files in the Obsidian Vault.
     */
    public async syncToMarkdown() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        console.log("[VAULT] Syncing to Markdown Vault...");

        try {
            const facts = await this.getAllFacts();
            const entities = this.db.query("SELECT * FROM entities").all() as any[];

            // 1. Write Entities to dedicated folder
            const entityDir = path.join(this.vaultPath, "Entities");
            if (!fs.existsSync(entityDir)) fs.mkdirSync(entityDir);

            for (const entity of entities) {
                const content = `# ${entity.name}\nType: ${entity.type}\n\n${entity.description}\n\n--- \nLast Active: ${entity.last_seen}`;
                fs.writeFileSync(path.join(entityDir, `${entity.name}.md`), content);
            }

            // 2. Write Facts by Entity
            const factsDir = path.join(this.vaultPath, "Facts");
            if (!fs.existsSync(factsDir)) fs.mkdirSync(factsDir);

            const groups: { [key: string]: string[] } = {};
            facts.forEach(f => {
                const entity = f.entity;
                if (!groups[entity]) groups[entity] = [];
                groups[entity]!.push(`- ${f.fact} (Relevance: ${f.relevance})`);
            });

            for (const [entity, list] of Object.entries(groups)) {
                const content = `# Facts about ${entity}\n\n${list.join("\n")}\n\n--- \nUpdated: ${new Date().toISOString()}`;
                fs.writeFileSync(path.join(factsDir, `${entity}.md`), content);
            }

            console.log("[VAULT] ✅ Markdown Sync Complete.");
        } catch (e: any) {
            console.error(`[VAULT] Markdown sync error: ${e.message}`);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Simple watcher to pick up manual changes from Obsidian.
     */
    public watchMarkdownVault() {
        console.log(`[VAULT] Watching Obsidian Vault at: ${this.vaultPath}`);
        fs.watch(this.vaultPath, { recursive: true }, (event, filename) => {
            if (filename && !this.isSyncing) {
                console.log(`[VAULT] Detect change in ${filename}, triggering re-sync...`);
                // Debounce a bit to avoid multiple triggers
                setTimeout(() => this.syncFromMarkdown(), 1000);
            }
        });
    }

    /**
     * Imports knowledge from Markdown files back into SQLite.
     * This allows manual additions in Obsidian to be indexed.
     */
    public async syncFromMarkdown() {
        if (this.isSyncing) return;
        this.isSyncing = true;

        try {
            const factsDir = path.join(this.vaultPath, "Facts");
            if (!fs.existsSync(factsDir)) return;

            const files = fs.readdirSync(factsDir).filter(f => f.endsWith(".md"));
            for (const file of files) {
                const entity = path.basename(file, ".md").replace("Facts about ", "");
                const content = fs.readFileSync(path.join(factsDir, file), "utf-8");

                // Parse bullet points
                const lines = content.split("\n");
                for (const line of lines) {
                    if (line.startsWith("- ")) {
                        const fact = line.substring(2).split(" (Relevance:")[0]!.trim();
                        // Check if exists
                        const existing = this.db.query("SELECT * FROM facts WHERE entity = ? AND fact = ?").get(entity, fact);
                        if (!existing) {
                            console.log(`[VAULT] Importing new fact from Obsidian: [${entity}] ${fact}`);
                            await this.storeFact(entity, fact, 0.7, { source: 'obsidian' });
                        }
                    }
                }
            }
        } catch (e: any) {
            console.error(`[VAULT] Sync from Markdown failed: ${e.message}`);
        } finally {
            this.isSyncing = false;
        }
    }
}

export const vault = new NexusVault();
