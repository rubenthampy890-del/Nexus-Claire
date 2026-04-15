/**
 * Nexus Claire: AppleScript Bridge
 * 
 * Native macOS integration for Mail, Calendar, and Notifications.
 */

import { toolRegistry, type ToolDefinition } from "../tool-registry";
import { spawnSync } from "bun";

function runAppleScript(script: string): string {
    try {
        const result = spawnSync(["osascript", "-e", script], { timeout: 15000 });
        const stdout = result.stdout?.toString().trim() || '';
        const stderr = result.stderr?.toString().trim() || '';
        if (result.exitCode !== 0) {
            throw new Error(`AppleScript error: ${stderr || 'Unknown error'}`);
        }
        return stdout || 'Command executed successfully (no output).';
    } catch (err: any) {
        throw new Error(`AppleScript execution failed: ${err.message}`);
    }
}

const appleScriptTools: ToolDefinition[] = [
    {
        name: 'mac.unread_emails',
        description: 'Get the latest unread emails from Apple Mail. Returns sender, subject, and date.',
        category: 'communication',
        parameters: {},
        execute: async () => {
            const script = `
tell application "Mail"
    set unreadMessages to (messages of inbox whose read status is false)
    set output to ""
    set maxCount to 5
    set i to 0
    repeat with msg in unreadMessages
        if i >= maxCount then exit repeat
        set senderName to sender of msg
        set subjectLine to subject of msg
        set dateReceived to date received of msg
        set output to output & "• From: " & senderName & return & "  Subject: " & subjectLine & return & "  Date: " & (dateReceived as string) & return & return
        set i to i + 1
    end repeat
    if output is "" then return "No unread emails."
    return output
end tell`;
            return runAppleScript(script);
        }
    },
    {
        name: 'mac.calendar',
        description: 'Get upcoming calendar events for the next 24 hours from Apple Calendar.',
        category: 'communication',
        parameters: {},
        execute: async () => {
            const script = `
tell application "Calendar"
    set now to current date
    set tomorrow to now + (1 * days)
    set output to ""
    repeat with cal in calendars
        set calEvents to (every event of cal whose start date >= now and start date <= tomorrow)
        repeat with evt in calEvents
            set evtTitle to summary of evt
            set evtStart to start date of evt
            set evtEnd to end date of evt
            set output to output & "• " & evtTitle & return & "  Start: " & (evtStart as string) & return & "  End: " & (evtEnd as string) & return & return
        end repeat
    end repeat
    if output is "" then return "No upcoming events in the next 24 hours."
    return output
end tell`;
            return runAppleScript(script);
        }
    },
    {
        name: 'mac.notify',
        description: 'Send a native macOS notification with a title and message.',
        category: 'system',
        parameters: {
            title: { type: 'string', description: 'Title of the notification.', required: false },
            subtitle: { type: 'string', description: 'Optional subtitle.', required: false },
            message: { type: 'string', description: 'Main notification text.', required: true }
        },
        execute: async (args: any) => {
            const script = `display notification "${args.message.replace(/"/g, '\\"')}" with title "${(args.title || 'Nexus Claire').replace(/"/g, '\\"')}" subtitle "${(args.subtitle || '').replace(/"/g, '\\"')}"`;
            return await runAppleScript(script);
        }
    },
    {
        name: 'mac.active_app',
        description: 'Get the name and window title of the currently active application.',
        category: 'system',
        parameters: {},
        execute: async () => {
            const script = `
tell application "System Events"
    set frontApp to name of first application process whose frontmost is true
    try
        set windowTitle to name of front window of (first application process whose frontmost is true)
    on error
        set windowTitle to "N/A"
    end try
    return frontApp & " — " & windowTitle
end tell`;
            return runAppleScript(script);
        }
    },
    {
        name: 'mac.open_app',
        description: 'Open an application by its exact name on macOS (e.g. Safari, Calculator).',
        category: 'system',
        parameters: { name: { type: 'string', description: 'The exact application name', required: true } },
        execute: async (args: any) => {
            const script = `tell application "${args.name}" to activate`;
            return runAppleScript(script);
        }
    },
    {
        name: 'mac.get_clipboard',
        description: 'Get the current text contents of the macOS clipboard.',
        category: 'system',
        parameters: {},
        execute: async () => {
            return runAppleScript('the clipboard as text');
        }
    },
    {
        name: 'mac.set_clipboard',
        description: 'Set text to the macOS clipboard.',
        category: 'system',
        parameters: { text: { type: 'string', description: 'The text to copy', required: true } },
        execute: async (args: any) => {
            const escaped = args.text.replace(/"/g, '\\"');
            return runAppleScript(`set the clipboard to "${escaped}"`);
        }
    },
    {
        name: 'mac.type',
        description: 'Type out a string of text using macOS System Events. The target app must be active.',
        category: 'system',
        parameters: { text: { type: 'string', description: 'The text to type', required: true } },
        execute: async (args: any) => {
            const escaped = args.text.replace(/"/g, '\\"');
            return runAppleScript(`delay 0.1\ntell application "System Events" to keystroke "${escaped}"`);
        }
    },
    {
        name: 'mac.press_key',
        description: 'Press a specific key exactly (e.g. "return", "enter", "space", "tab").',
        category: 'system',
        parameters: { key: { type: 'string', description: 'The key to press (return, space, tab, enter)', required: true } },
        execute: async (args: any) => {
            let keyCode;
            switch (args.key.toLowerCase()) {
                case 'return': case 'enter': keyCode = 36; break;
                case 'space': keyCode = 49; break;
                case 'tab': keyCode = 48; break;
                case 'escape': case 'esc': keyCode = 53; break;
                default: throw new Error(`Unsupported key name: ${args.key}`);
            }
            return runAppleScript(`delay 0.1\ntell application "System Events" to key code ${keyCode}`);
        }
    },
    {
        name: 'mac.type_in_app',
        description: 'Focus a specific app first, then type text into it. For browsers (Safari/Chrome/Firefox/Arc), it will focus the address bar with Cmd+L before typing. Optionally presses Enter after.',
        category: 'system',
        parameters: {
            app: { type: 'string', description: 'The app to focus (e.g. Safari, Google Chrome)', required: true },
            text: { type: 'string', description: 'The text to type', required: true },
            press_enter: { type: 'boolean', description: 'Whether to press Enter after typing', required: false }
        },
        execute: async (args: any) => {
            const app = args.app;
            const escaped = args.text.replace(/"/g, '\\"');
            const browsers = ['safari', 'google chrome', 'chrome', 'firefox', 'arc', 'brave', 'opera', 'edge', 'microsoft edge'];
            const isBrowser = browsers.some(b => app.toLowerCase().includes(b));

            let script = `tell application "${app}" to activate\ndelay 0.3\n`;
            if (isBrowser) {
                // Cmd+L to focus address bar
                script += `tell application "System Events" to keystroke "l" using command down\ndelay 0.2\n`;
            }
            script += `tell application "System Events" to keystroke "${escaped}"\n`;
            if (args.press_enter) {
                script += `delay 0.1\ntell application "System Events" to key code 36\n`;
            }
            return runAppleScript(script);
        }
    }
];

export function registerAppleScriptTools() {
    appleScriptTools.forEach(tool => toolRegistry.register(tool));
    console.log('[APPLESCRIPT] macOS Mail, Calendar, and Notification tools registered.');
}
