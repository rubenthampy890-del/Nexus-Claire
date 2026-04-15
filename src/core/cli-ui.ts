import chalk from "chalk";
import { exec } from "node:child_process";

/**
 * Nexus CLI UI: A premium terminal interface for Nexus Claire.
 * Handles boxes, colors, and clickable links.
 */
export class NexusCLI {
    private static readonly CYAN = "#00F0FF";
    private static readonly BORDER = "─";
    private static activeSpinner: NodeJS.Timeout | null = null;

    public static showLogo() {
        console.clear();
        const logo = `
   ${chalk.hex(this.CYAN)("▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄")}
   ${chalk.hex(this.CYAN).bold(" ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗")}${chalk.hex(this.CYAN)("      [ v4.0 ]")}
   ${chalk.hex(this.CYAN).bold(" ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝")}
   ${chalk.hex(this.CYAN).bold(" ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗")}
   ${chalk.hex(this.CYAN).bold(" ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║")}
   ${chalk.hex(this.CYAN).bold(" ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║")}
   ${chalk.hex(this.CYAN).bold(" ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝")}
   ${chalk.hex(this.CYAN)(" ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀")}
        `;
        console.log(logo);
    }

    public static async spinner(message: string, duration: number = 0): Promise<void> {
        const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        let i = 0;

        const start = Date.now();
        this.stopSpinner();

        return new Promise((resolve) => {
            this.activeSpinner = setInterval(() => {
                process.stdout.write(`\r   ${chalk.hex(this.CYAN)(frames[i % frames.length])} ${chalk.white(message)}`);
                i++;

                if (duration > 0 && Date.now() - start > duration) {
                    this.stopSpinner(true);
                    resolve();
                }
            }, 80);

            if (duration === 0) resolve();
        });
    }

    public static stopSpinner(success: boolean = true) {
        if (this.activeSpinner) {
            clearInterval(this.activeSpinner);
            this.activeSpinner = null;
            const symbol = success ? chalk.green("✔") : chalk.red("✖");
            process.stdout.write(`\r   ${symbol} \n`);
        }
    }

    public static showSection(title: string) {
        console.log(`\n   ${chalk.hex(this.CYAN).bold(title.toUpperCase())}`);
        console.log(`   ${chalk.hex(this.CYAN)("─".repeat(title.length))}`);
    }

    public static showStatus(label: string, status: string, color: string = "#00F0FF") {
        const symbol = status.toLowerCase() === "ok" || status.toLowerCase().includes("ready") ? "●" : "○";
        console.log(`     ${chalk.hex(color)(symbol)} ${chalk.gray(label.padEnd(18, "."))} ${chalk.hex(color)(status)}`);
    }

    public static showBanner() {
        this.showLogo();
    }

    public static showDashboardLink() {
        const url = "http://localhost:5173";
        console.log("\n");
        console.log(" ".repeat(4) + chalk.hex(this.CYAN).bold("⚡ SYSTEM UPLINK READY"));
        console.log(" ".repeat(4) + chalk.white("Dashboard: ") + chalk.hex(this.CYAN).underline(url));
        console.log("\n");
        console.log(" ".repeat(4) + chalk.hex(this.CYAN)("─".repeat(50)));
        console.log("\n");
    }

    /**
     * Auto-open the dashboard in the default browser.
     * Uses macOS `open` command.
     */
    public static openDashboard() {
        const url = "http://localhost:5173";
        exec(`open "${url}"`, (err) => {
            if (err) {
                console.warn(chalk.yellow(`[CLI] Could not auto-open dashboard: ${err.message}`));
            }
        });
    }

    /**
     * Quiet log: only prints if --debug flag is active.
     * Use this for noisy subsystem chatter (VAULT sync, etc).
     */
    public static quietLog(message: string, type: "INFO" | "WARN" | "ERROR" | "MEMORY" = "INFO") {
        if (process.argv.includes('--debug')) {
            this.log(message, type);
        }
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
