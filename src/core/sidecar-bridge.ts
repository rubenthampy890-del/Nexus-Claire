import { spawn } from "bun";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlatformUtils } from "./platform";

/**
 * SidecarBridge — Native OS interface for screen capture and OS metadata.
 * Uses cross-platform PlatformUtils abstraction instead of hardcoded macOS binaries.
 */
export class SidecarBridge {
    private static instance: SidecarBridge;
    private tempFile: string;

    private constructor() {
        this.tempFile = join(tmpdir(), `nexus_capture_${Date.now()}.png`);
    }

    public static getInstance(): SidecarBridge {
        if (!SidecarBridge.instance) {
            SidecarBridge.instance = new SidecarBridge();
        }
        return SidecarBridge.instance;
    }

    /**
     * Captures the primary screen to a buffer.
     * Uses cross-platform screen capture APIs.
     */
    public async captureScreen(): Promise<Buffer | null> {
        const tempPath = join(tmpdir(), `nexus_capture_${Date.now()}_${Math.random().toString(36).substring(7)}.png`);
        try {
            await PlatformUtils.captureScreen(tempPath);

            const file = Bun.file(tempPath);
            const exists = await file.exists();
            if (!exists) {
                console.error(`[SidecarBridge] Capture file not found at ${tempPath}`);
                return null;
            }

            const buffer = Buffer.from(await file.arrayBuffer());

            // Clean up
            await unlink(tempPath).catch(() => { });

            return buffer;
        } catch (error) {
            console.error(`[SidecarBridge] Capture error:`, error);
            return null;
        }
    }

    /**
     * Get basic OS metadata (Active Window title, App Name)
     * On macOS, this requires AppleScript.
     */
    public async getActiveWindow(): Promise<{ app: string; title: string }> {
        try {
            const script = `
                tell application "System Events"
                    set frontApp to name of first application process whose frontmost is true
                    tell process frontApp
                        set windowTitle to name of window 1
                    end tell
                end tell
                return frontApp & "|SPLIT|" & windowTitle
            `;

            const proc = spawn(["osascript", "-e", script]);
            const output = await new Response(proc.stdout).text();

            const [app, title] = output.trim().split("|SPLIT|");
            return {
                app: app || "Unknown",
                title: title || "Unknown"
            };
        } catch (error) {
            return { app: "Unknown", title: "Unknown" };
        }
    }
}

export const sidecar = SidecarBridge.getInstance();
