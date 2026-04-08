/**
 * ╔══════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — BROWSER AGENT v1.0              ║
 * ║       Persistent Social Bridge                       ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Uses Playwright with a persistent user data directory to stay logged
 * into social media platforms (Twitter, Instagram, LinkedIn).
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

export class NexusBrowserAgent {
    private context: BrowserContext | null = null;
    private currentPage: Page | null = null;
    private profileDir: string;

    constructor() {
        const dataDir = join(process.cwd(), "data");
        this.profileDir = join(dataDir, "browser_profile");
        if (!existsSync(this.profileDir)) {
            mkdirSync(this.profileDir, { recursive: true });
        }
    }

    /**
     * Start the persistent browser session.
     */
    public async start(): Promise<void> {
        if (this.context) return;

        console.log("[BROWSER] Launching persistent social bridge...");

        try {
            this.context = await chromium.launchPersistentContext(this.profileDir, {
                headless: true,
                viewport: { width: 1280, height: 720 },
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });

            // Create a default page
            this.currentPage = await this.context.newPage();
            console.log("[BROWSER] Session started. Logins across reboots will persist.");
        } catch (e: any) {
            console.error(`[BROWSER FAIL] Could not launch Playwright: ${e.message}`);
            console.error(`[BROWSER FAIL] Make sure you ran: npx playwright install chromium`);
        }
    }

    /**
     * Shut down the browser gracefully.
     */
    public async stop(): Promise<void> {
        if (this.context) {
            await this.context.close();
            this.context = null;
            this.currentPage = null;
            console.log("[BROWSER] Session closed.");
        }
    }

    // ──────────── Core Social Navigations ────────────

    /**
     * Navigate to a specific URL.
     */
    public async navigate(url: string): Promise<string> {
        if (!this.currentPage) await this.start();
        if (!this.currentPage) throw new Error("Browser failed to start.");

        console.log(`[BROWSER] Navigating to ${url}...`);
        await this.currentPage.goto(url, { waitUntil: 'domcontentloaded' });
        return await this.currentPage.title();
    }

    /**
     * Get the inner text of a specific selector.
     */
    public async scrapeText(selector: string): Promise<string> {
        if (!this.currentPage) return "Error: Browser not started.";
        try {
            await this.currentPage.waitForSelector(selector, { timeout: 5000 });
            return await this.currentPage.innerText(selector);
        } catch (e: any) {
            return `Error extracting text: ${e.message}`;
        }
    }

    /**
     * Attempt to type text into an input field.
     */
    public async type(selector: string, text: string): Promise<string> {
        if (!this.currentPage) return "Error: Browser not started.";
        try {
            await this.currentPage.fill(selector, text);
            return `Typed text into ${selector}`;
        } catch (e: any) {
            return `Error typing: ${e.message}`;
        }
    }

    /**
     * Attempt to click an element.
     */
    public async click(selector: string): Promise<string> {
        if (!this.currentPage) return "Error: Browser not started.";
        try {
            await this.currentPage.click(selector);
            return `Clicked ${selector}`;
        } catch (e: any) {
            return `Error clicking: ${e.message}`;
        }
    }

    /**
     * Takes a screenshot for visual awareness.
     * Saved to data/screenshot.png
     */
    public async screenshot(): Promise<string> {
        if (!this.currentPage) return "Error: Browser not started.";
        const path = join(process.cwd(), "data", "screenshot.png");
        await this.currentPage.screenshot({ path });
        return `Visual awareness captured at ${path}`;
    }
}

export const browserAgent = new NexusBrowserAgent();
