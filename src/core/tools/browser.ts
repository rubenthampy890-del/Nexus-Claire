import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NexusCLI } from '../cli-ui';
import { toolRegistry } from '../tool-registry';

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   NEXUS CLAIRE — PERSISTENT BROWSER ENGINE v2.0                 ║
 * ║   Session Storage · Social Login Persistence · Screenshot Sync  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Key features:
 *   - Persistent browser context: cookies/localStorage survive restarts
 *   - Screenshot broadcasting to Dashboard via callback
 *   - Social media login persistence (Instagram, Gmail, etc.)
 *   - Session stored in ~/.nexus-claire/browser-session
 */

const SESSION_DIR = resolve(
    process.env.HOME || '/tmp',
    '.nexus-claire',
    'browser-session'
);

// Callback type for broadcasting snapshots to the dashboard
type SnapshotCallback = (base64: string, url: string) => void;
type LogCallback = (message: string) => void;

export class BrowserEngine {
    private static instance: BrowserEngine;
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;

    // UI sync callbacks
    public onSnapshot: SnapshotCallback | null = null;
    public onBrowserLog: LogCallback | null = null;

    private constructor() { }

    public static getInstance(): BrowserEngine {
        if (!BrowserEngine.instance) {
            BrowserEngine.instance = new BrowserEngine();
        }
        return BrowserEngine.instance;
    }

    /**
     * Ensure the browser is running with a PERSISTENT context.
     * Cookies, localStorage, and session data are stored on disk.
     */
    private async ensureBrowser() {
        if (this.browser && this.page) return;

        // Ensure session directory exists
        if (!existsSync(SESSION_DIR)) {
            mkdirSync(SESSION_DIR, { recursive: true });
        }

        NexusCLI.log("[BROWSER] Launching Persistent Playwright...", "INFO");
        this.log("Launching browser with persistent session...");

        this.browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        // Use launchPersistentContext for full session persistence
        // Note: We re-create context from saved state
        this.context = await this.browser.newContext({
            viewport: { width: 1280, height: 720 },
            storageState: this.getStorageStatePath(),
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        this.page = await this.context.newPage();

        // Auto-save session state after each navigation
        this.page.on('load', async () => {
            await this.saveSessionState();
            await this.broadcastSnapshot();
        });

        NexusCLI.log(`[BROWSER] Session directory: ${SESSION_DIR}`, "INFO");
    }

    /**
     * Get the path to the stored session state file.
     * Returns undefined if no saved state exists yet.
     */
    private getStorageStatePath(): string | undefined {
        const statePath = join(SESSION_DIR, 'state.json');
        return existsSync(statePath) ? statePath : undefined;
    }

    /**
     * Save the current browser context state (cookies, localStorage)
     * to disk for persistence across restarts.
     */
    private async saveSessionState() {
        if (!this.context) return;
        try {
            const statePath = join(SESSION_DIR, 'state.json');
            await this.context.storageState({ path: statePath });
        } catch (e: any) {
            // Non-fatal: session save can fail if context is closing
            NexusCLI.quietLog(`[BROWSER] Session save warning: ${e.message}`, "WARN");
        }
    }

    /**
     * Take a screenshot and broadcast it to the dashboard.
     */
    private async broadcastSnapshot() {
        if (!this.page || !this.onSnapshot) return;
        try {
            const buffer = await this.page.screenshot();
            const base64 = buffer.toString('base64');
            const url = this.page.url();
            this.onSnapshot(base64, url);
        } catch { /* page may have closed */ }
    }

    private log(message: string) {
        if (this.onBrowserLog) this.onBrowserLog(message);
    }

    // ──────────── Public API ────────────

    public async navigate(url: string) {
        await this.ensureBrowser();
        this.log(`Navigating to ${url}`);
        NexusCLI.log(`[BROWSER] Navigating to ${url}...`, "INFO");
        try {
            await this.page!.goto(url, { waitUntil: 'load', timeout: 30000 });
            await this.broadcastSnapshot();
            return { success: true, url: this.page!.url(), title: await this.page!.title() };
        } catch (e: any) {
            this.log(`Navigation failed: ${e.message}`);
            throw new Error(`Browser navigate failed: ${e.message}`);
        }
    }

    public async click(selector: string) {
        await this.ensureBrowser();
        this.log(`Clicking: ${selector}`);
        try {
            await this.page!.waitForSelector(selector, { state: 'visible', timeout: 8000 });
            await this.page!.click(selector);
            await this.page!.waitForTimeout(500);
            await this.broadcastSnapshot();
            return { success: true };
        } catch (e: any) {
            this.log(`Click failed: ${e.message}`);
            throw new Error(`Browser click failed: ${e.message}`);
        }
    }

    public async type(selector: string, text: string) {
        await this.ensureBrowser();
        this.log(`Typing into: ${selector}`);
        try {
            await this.page!.waitForSelector(selector, { state: 'visible', timeout: 8000 });
            await this.page!.fill(selector, text);
            await this.broadcastSnapshot();
            return { success: true };
        } catch (e: any) {
            this.log(`Type failed: ${e.message}`);
            throw new Error(`Browser type failed: ${e.message}`);
        }
    }

    public async pressKey(key: string) {
        await this.ensureBrowser();
        this.log(`Pressing key: ${key}`);
        try {
            await this.page!.keyboard.press(key);
            await this.page!.waitForTimeout(500);
            await this.broadcastSnapshot();
            return { success: true };
        } catch (e: any) {
            this.log(`Key press failed: ${e.message}`);
            throw new Error(`Browser press key failed: ${e.message}`);
        }
    }

    public async screenshot() {
        await this.ensureBrowser();
        try {
            const buffer = await this.page!.screenshot();
            const base64 = buffer.toString('base64');
            const url = this.page!.url();
            if (this.onSnapshot) this.onSnapshot(base64, url);
            return { success: true, base64, url };
        } catch (e: any) {
            throw new Error(`Browser screenshot failed: ${e.message}`);
        }
    }

    public async getContent() {
        await this.ensureBrowser();
        try {
            const text = await this.page!.evaluate(() => (globalThis as any).document.body.innerText);
            return text.substring(0, 5000);
        } catch (e: any) {
            throw new Error(`Browser getContent failed: ${e.message}`);
        }
    }

    public async waitForSelector(selector: string, timeout: number = 10000) {
        await this.ensureBrowser();
        this.log(`Waiting for: ${selector}`);
        try {
            await this.page!.waitForSelector(selector, { state: 'visible', timeout });
            await this.broadcastSnapshot();
            return { success: true, found: true };
        } catch {
            return { success: true, found: false };
        }
    }

    public async close() {
        if (this.context) {
            await this.saveSessionState();
        }
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
        }
    }
}

export const browserEngine = BrowserEngine.getInstance();

// ──────────── Tool Registration ────────────

export function registerBrowserTools() {
    toolRegistry.register({
        name: 'browser.navigate',
        category: 'browser',
        description: 'Navigate to a URL using the autonomous browser with persistent sessions. Logins and cookies are remembered across restarts.',
        parameters: {
            url: { type: 'string', description: 'The absolute URL to visit.', required: true }
        },
        execute: async (args) => JSON.stringify(await browserEngine.navigate(args.url))
    });

    toolRegistry.register({
        name: 'browser.click',
        category: 'browser',
        description: 'Click an element on the current page by CSS selector.',
        parameters: {
            selector: { type: 'string', description: 'The CSS selector of the element to click.', required: true }
        },
        execute: async (args) => JSON.stringify(await browserEngine.click(args.selector))
    });

    toolRegistry.register({
        name: 'browser.type',
        category: 'browser',
        description: 'Type text into an input field on the current page.',
        parameters: {
            selector: { type: 'string', description: 'The CSS selector of the input field.', required: true },
            text: { type: 'string', description: 'The text to type.', required: true }
        },
        execute: async (args) => JSON.stringify(await browserEngine.type(args.selector, args.text))
    });

    toolRegistry.register({
        name: 'browser.press_key',
        category: 'browser',
        description: 'Press a keyboard key (Enter, Tab, Escape, etc.) in the browser.',
        parameters: {
            key: { type: 'string', description: 'The key to press (e.g. "Enter", "Tab", "Escape").', required: true }
        },
        execute: async (args) => JSON.stringify(await browserEngine.pressKey(args.key))
    });

    toolRegistry.register({
        name: 'browser.screenshot',
        category: 'browser',
        description: 'Take a screenshot of the current browser viewport. Returns a base64-encoded PNG.',
        parameters: {},
        execute: async () => JSON.stringify(await browserEngine.screenshot())
    });

    toolRegistry.register({
        name: 'browser.read_page',
        category: 'browser',
        description: 'Read the visible text content of the current browser page.',
        parameters: {},
        execute: async () => await browserEngine.getContent()
    });

    toolRegistry.register({
        name: 'browser.wait_for',
        category: 'browser',
        description: 'Wait for a CSS selector to appear on the page (useful after clicking or navigating).',
        parameters: {
            selector: { type: 'string', description: 'CSS selector to wait for.', required: true },
            timeout: { type: 'number', description: 'Max wait time in ms (default 10000).', required: false }
        },
        execute: async (args) => JSON.stringify(await browserEngine.waitForSelector(args.selector, args.timeout))
    });

    NexusCLI.log("[BROWSER] 7 persistent browser tools registered.", "INFO");
}
