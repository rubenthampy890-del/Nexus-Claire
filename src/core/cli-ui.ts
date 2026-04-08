import chalk from "chalk";

/**
 * Nexus CLI UI: A premium terminal interface for Nexus Claire.
 * Handles boxes, colors, and clickable links.
 */
export class NexusCLI {
    private static readonly CYAN = "#00F0FF";
    private static readonly BORDER = "─";

    public static showBanner() {
        console.clear();
        const line = " ".repeat(4) + chalk.hex(this.CYAN)("─".repeat(50));
        console.log("\n");
        console.log(line);
        console.log(" ".repeat(15) + chalk.hex(this.CYAN).bold("N E X U S   C L A I R E   v 3 . 0"));
        console.log(" ".repeat(19) + chalk.hex(this.CYAN)("A U T O N O M O U S   D A E M O N"));
        console.log(line);
        console.log("\n");
    }

    public static showStatus(label: string, status: string, color: string = "#00F0FF") {
        const paddedLabel = label.padEnd(15, " ");
        console.log(" ".repeat(4) + chalk.white(paddedLabel) + " → " + chalk.hex(color)(status));
    }

    public static showDashboardLink() {
        console.log("\n");
        console.log(" ".repeat(4) + chalk.hex(this.CYAN).bold("⚡ SYSTEM UPLINK READY"));
        console.log(" ".repeat(4) + chalk.white("Open Dashboard: ") + chalk.hex(this.CYAN).underline("http://localhost:5173"));
        console.log("\n");
        console.log(" ".repeat(4) + chalk.hex(this.CYAN)("─".repeat(50)));
        console.log("\n");
    }

    public static log(message: string, type: "INFO" | "WARN" | "ERROR" | "MEMORY" = "INFO") {
        const colors = {
            INFO: "#00F0FF",
            WARN: "#FFCC00",
            ERROR: "#FF3366",
            MEMORY: "#9933FF"
        };
        const timestamp = new Date().toLocaleTimeString([], { hour12: false });
        console.log(chalk.gray(`[${timestamp}] `) + chalk.hex(colors[type])(`[${type}] `) + chalk.white(message));
    }
}
