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
            try {
                this.supabase = createClient(supabaseUrl, supabaseKey);
                console.log("[VAULT] Supabase LTM Layer Active.");
                // Start cloud sync in background (don't block constructor)
                this.cloudPullOnBoot().catch(e => console.warn(`[VAULT] Cloud pull skipped: ${e.message}`));
            } catch (e: any) {
                console.warn(`[VAULT] Supabase client creation failed: ${e.message}. Running in local-only mode.`);
                this.supabase = null;
            }
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
                embedding_json TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Schema migration: Add columns that may not exist in older databases
        // SQLite's CREATE TABLE IF NOT EXISTS won't add new columns to existing tables
        const migrations = [
            { column: 'embedding_json', sql: 'ALTER TABLE facts ADD COLUMN embedding_json TEXT' },
            { column: 'last_accessed', sql: 'ALTER TABLE facts ADD COLUMN last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP' }
        ];
        for (const { column, sql } of migrations) {
            try {
                // Check if column exists by querying pragma
                const cols = this.db.query(`PRAGMA table_info(facts)`).all() as any[];
                const exists = cols.some((c: any) => c.name === column);
                if (!exists) {
                    this.db.run(sql);
                    console.log(`[VAULT] Migration: Added '${column}' column to facts table.`);
                }
            } catch (e: any) {
                // Column already exists or other benign error
            }
        }

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

    /**
     * Memory Decay & Pruning:
     * Reduces relevance of old, unaccessed facts.
     */
    public async maintenance() {
        console.log("[VAULT] Running Memory Maintenance...");

        // 1. Decay Relevance: -5% for facts not accessed in 7 days
        this.db.run(`
            UPDATE facts 
            SET relevance = relevance * 0.95 
            WHERE last_accessed < datetime('now', '-7 days') AND relevance > 0.1
        `);

        // 2. Prune: Remove facts with relevance < 0.1 (forgotten)
        const pruned = this.db.run("DELETE FROM facts WHERE relevance < 0.1");
        if (pruned.changes > 0) {
            console.log(`[VAULT] Pruned ${pruned.changes} low-relevance memories.`);
        }

        // 3. Cluster: Group highly similar facts (redundancy check)
        await this.clusterMemories();
        console.log("[VAULT] Maintenance Complete.");
    }

    private async generateEmbedding(text: string): Promise<number[]> {
        if (!process.env.GEMINI_API_KEY) {
            return [];
        }
        try {
            const response = await this.geminiClient.models.embedContent({
                model: "gemini-embedding-001",
                contents: text
            });
            return response.embeddings?.[0]?.values || [];
        } catch (err: any) {
            if (err.message?.includes('API key not valid')) {
                console.error("[VAULT] Invalid GEMINI_API_KEY. Embeddings disabled.");
                process.env.GEMINI_API_KEY = ""; // disable for future calls to stop spam
            } else {
                console.error("[VAULT] Embedding failed:", err.message);
            }
            return [];
        }
    }

    public async storeFact(entity: string, fact: string, relevance: number = 1.0, metadata: any = {}) {
        // 1. Store Locally (SQL Layer) — always succeeds
        try {
            const embedding = await this.generateEmbedding(fact);
            const embeddingJson = embedding.length > 0 ? JSON.stringify(embedding) : null;

            this.db.run(
                "INSERT INTO facts (entity, fact, relevance, embedding_json) VALUES (?, ?, ?, ?)",
                [entity, fact, relevance, embeddingJson]
            );
            console.log(`[VAULT] Fact stored locally with neural embedding: ${fact.substring(0, 80)}`);
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
        if (!this.supabase) {
            return this.localVectorSearch(query, limit);
        }

        const embedding = await this.generateEmbedding(query);
        if (embedding.length === 0) return this.localVectorSearch(query, limit);

        try {
            const { data, error } = await this.supabase.rpc('match_facts', {
                query_embedding: embedding,
                match_threshold: 0.5,
                match_count: limit
            });

            if (error) {
                console.error("[VAULT] Supabase search error, falling back to local...");
                return this.localVectorSearch(query, limit);
            }

            const results = (data || []).map((row: any) => ({
                id: row.id,
                entity: row.entity,
                fact: row.content,
                relevance: row.similarity,
                timestamp: new Date().toISOString(),
                similarity: row.similarity
            }));

            // Update last_accessed for the found facts
            if (results.length > 0) {
                const ids = results.map((r: VaultFact) => r.id).join(',');
                this.db.run(`UPDATE facts SET last_accessed = CURRENT_TIMESTAMP WHERE id IN (${ids})`);
            }

            return results;
        } catch (e) {
            return this.localVectorSearch(query, limit);
        }
    }

    /**
     * Local Neural Fallback: Perform Cosine Similarity in-memory over SQLite records.
     */
    private async localVectorSearch(query: string, limit: number = 5): Promise<VaultFact[]> {
        console.log(`[VAULT] 🧠 Performing Local neural search for: "${query.substring(0, 30)}..."`);
        const queryEmbedding = await this.generateEmbedding(query);
        if (queryEmbedding.length === 0) return [];

        const allFacts = this.db.query("SELECT * FROM facts WHERE embedding_json IS NOT NULL").all() as any[];
        const scored = allFacts.map(f => {
            const factEmbedding = JSON.parse(f.embedding_json);
            return {
                id: f.id,
                entity: f.entity,
                fact: f.fact,
                relevance: f.relevance,
                timestamp: f.timestamp,
                similarity: this.cosineSimilarity(queryEmbedding, factEmbedding)
            };
        }).filter(f => f.similarity > 0.6);

        return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
    }

    /**
     * Delete a fact from local and cloud storage.
     */
    public async deleteFact(id: number) {
        console.log(`[VAULT] 🗑️ Deleting fact ID: ${id}`);
        this.db.run("DELETE FROM facts WHERE id = ?", [id]);
        if (this.supabase) {
            await this.supabase.from('facts').delete().eq('id', id);
        }
    }

    /**
     * Update an existing fact.
     */
    public async updateFact(id: number, content: string) {
        console.log(`[VAULT] 🔄 Updating fact ID: ${id}`);
        this.db.run("UPDATE facts SET fact = ?, last_accessed = CURRENT_TIMESTAMP WHERE id = ?", [content, id]);
        if (this.supabase) {
            const embedding = await this.generateEmbedding(content);
            await this.supabase.from('facts').update({ content, embedding }).eq('id', id);
        }
    }

    /**
     * Semantic Clustering: Finds near-duplicate memories and merges them.
     * Upgraded from Jaccard to Vector-based Cosine Similarity.
     */
    public async clusterMemories() {
        if (!this.supabase) {
            // Fallback to basic clustering if no vector layer
            return this.clusterMemoriesLegacy();
        }

        console.log("[VAULT] 🧠 Clustering memories via Neural Embeddings...");
        const { data, error } = await this.supabase
            .from('facts')
            .select('id, entity, content, embedding');

        if (error || !data) return;

        const pairsToMerge: Array<{ master: number; duplicate: number }> = [];

        for (let i = 0; i < data.length; i++) {
            for (let j = i + 1; j < data.length; j++) {
                const f1 = data[i]!;
                const f2 = data[j]!;

                if (f1.entity !== f2.entity) continue;

                const similarity = this.cosineSimilarity(f1.embedding, f2.embedding);
                if (similarity > 0.95) {
                    pairsToMerge.push({ master: f1.id, duplicate: f2.id });
                }
            }
        }

        for (const { master, duplicate } of pairsToMerge) {
            console.log(`[VAULT] Merging near-duplicate: ${duplicate} -> ${master}`);
            await this.deleteFact(duplicate);
            this.db.run("UPDATE facts SET relevance = MIN(relevance + 0.1, 1.0) WHERE id = ?", [master]);
        }
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i]! * vecB[i]!;
            normA += vecA[i]! * vecA[i]!;
            normB += vecB[i]! * vecB[i]!;
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private async clusterMemoriesLegacy() {
        console.log("[VAULT] Clustering semantic memories (Legacy Jaccard)...");
        const facts = await this.getAllFacts();

        for (let i = 0; i < facts.length; i++) {
            for (let j = i + 1; j < facts.length; j++) {
                const f1 = facts[i]!;
                const f2 = facts[j]!;

                // If same entity and facts are very similar (keyword-based simple check for now)
                // In production, this would use cosine similarity of embeddings
                if (f1.entity === f2.entity && this.isSimilar(f1.fact, f2.fact)) {
                    console.log(`[VAULT] Merging clusters: "${f1.fact.substring(0, 30)}" <-> "${f2.fact.substring(0, 30)}"`);
                    // Boost first, delete second
                    this.db.run("UPDATE facts SET relevance = MIN(relevance + 0.1, 1.0) WHERE id = ?", [f1.id]);
                    this.db.run("DELETE FROM facts WHERE id = ?", [f2.id]);
                }
            }
        }
    }

    private isSimilar(a: string, b: string): boolean {
        const wordsA = new Set(a.toLowerCase().split(/\s+/));
        const wordsB = new Set(b.toLowerCase().split(/\s+/));
        const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
        const union = new Set([...wordsA, ...wordsB]);
        return (intersection.size / union.size) > 0.8; // 80% Jaccard similarity
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
