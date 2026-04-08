import { taskManager } from "./task-manager";
import { orchestrator } from "./orchestrator";
import { type RoleDefinition } from "./types";
import { sidecar } from "./sidecar-bridge";
import { createWorker } from "tesseract.js";

export type AwarenessEvent = {
    type: 'error' | 'struggle' | 'success' | 'capture';
    source: string;
    message: string;
    timestamp: number;
    metadata?: any;
};

export class NexusAwarenessService {
    private events: AwarenessEvent[] = [];
    private lastBuffer: Buffer | null = null;
    private interval: Timer | null = null;
    private isAnalysing = false;

    constructor() { }

    /**
     * Start the Perception Loop (The Heartbeat).
     * Captures the screen at intervals and checks for "struggles".
     */
    public start(intervalMs: number = 10000): void {
        if (this.interval) clearInterval(this.interval);

        console.log(`[AWARENESS] Starting perception loop (${intervalMs}ms)...`);
        this.interval = setInterval(() => this.perceive(), intervalMs);
    }

    public stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    /**
     * The core perception logic.
     */
    private async perceive(): Promise<void> {
        if (this.isAnalysing) return;
        this.isAnalysing = true;

        try {
            const buffer = await sidecar.captureScreen();
            if (!buffer) {
                this.isAnalysing = false;
                return;
            }

            // 1. Pixel-Diff check
            const changePct = this.computePixelDiff(buffer);
            if (changePct < 0.02 && this.lastBuffer !== null) {
                // No significant change, skip analysis
                this.isAnalysing = false;
                return;
            }

            this.lastBuffer = buffer;
            const window = await sidecar.getActiveWindow();

            // 2. OCR Extraction
            const text = await this.performOCR(buffer);

            // 3. Struggle Detection (Keywords)
            const lowerText = text.toLowerCase();
            const errors = ["error", "exception", "failed", "crash", "bug", "timeout", "rejected"];
            const foundErrors = errors.filter(e => lowerText.includes(e));

            if (foundErrors.length > 0) {
                this.reportEvent({
                    type: 'struggle',
                    source: window.app,
                    message: `Detected screen errors: ${foundErrors.join(", ")} | Window: ${window.title}`,
                    timestamp: Date.now(),
                    metadata: { ocr: text, window }
                });
            } else {
                this.reportEvent({
                    type: 'capture',
                    source: window.app,
                    message: `Captured state: ${window.title}`,
                    timestamp: Date.now()
                });
            }

        } catch (error) {
            console.error(`[AWARENESS] Perception error:`, error);
        } finally {
            this.isAnalysing = false;
        }
    }

    private async performOCR(buffer: Buffer): Promise<string> {
        const worker = await createWorker('eng');
        const ret = await worker.recognize(buffer);
        await worker.terminate();
        return ret.data.text;
    }

    /**
     * Sample pixels to detect screen changes efficiently.
     */
    private computePixelDiff(current: Buffer): float64 {
        if (!this.lastBuffer) return 1.0;
        if (current.length !== this.lastBuffer.length) return 1.0;

        const step = 100; // Sample every 100th byte for speed
        let changed = 0;
        let total = 0;

        for (let i = 0; i < current.length; i += step) {
            total++;
            if (current[i] !== this.lastBuffer[i]) {
                changed++;
            }
        }

        return changed / total;
    }

    public reportEvent(event: AwarenessEvent): void {
        this.events.push(event);
        console.log(`[AWARENESS] Event [${event.type}] from ${event.source}: ${event.message.slice(0, 80)}...`);

        if (event.type === 'error' || event.type === 'struggle') {
            this.handleStruggle(event);
        }
    }

    private handleStruggle(event: AwarenessEvent): void {
        // Debounce: don't trigger if we already have an active engineer for this source
        const activeTasks = taskManager.getTasks().filter(t => t.status === 'active');
        if (activeTasks.some(t => t.task.includes(event.source))) return;

        console.log(`[AWARENESS] !!! STRUGGLE TRIGGERED !!! Automating fix for ${event.source}...`);

        const engineerRole: RoleDefinition = {
            id: 'nexus-engineer-proactive',
            name: 'Nexus Sentinel (Proactive)',
            description: 'A proactive engineering role that researches and fixes screen errors autonomously.',
            responsibilities: ['Autonomous debugging', 'Screen-based error resolution'],
            autonomous_actions: ['fs.write', 'terminal.run', 'browser.search'],
            approval_required: [],
            kpis: [],
            communication_style: { tone: 'technical', verbosity: 'concise', formality: 'casual' },
            heartbeat_instructions: 'Analyze the OCR data and fix the error visible on the user screen.',
            sub_roles: [],
            tools: ['terminal.run', 'fs.read', 'fs.write', 'browser.search'],
            authority_level: 9
        };

        const agent = orchestrator.spawnAgent(engineerRole);

        taskManager.launch({
            agent,
            task: `A struggle was detected on screen in ${event.source}. 
            OCR Data: ${event.metadata?.ocr?.slice(0, 500)}
            Window: ${event.metadata?.window?.title}
            Analyze the situation and resolve the issue. If it's a code error, fix it in the workspace.`,
            context: `Last Events: ${JSON.stringify(this.events.slice(-3))}`,
            onComplete: (task) => {
                orchestrator.terminateAgent(agent.id);
            }
        });
    }

    public getHistory(): AwarenessEvent[] {
        return [...this.events];
    }
}

export const awareness = new NexusAwarenessService();
