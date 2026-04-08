/**
 * Nexus Claire: AppleScript Bridge
 * 
 * Native macOS integration for Mail, Calendar, and Notifications.
 */

import { toolRegistry, type ToolDefinition } from "../registry";
import { spawnSync } from "bun";

function runAppleScript(script: string): string {
    try {
        const result = spawnSync(["osascript", "-e", script], { timeout: 15000 });
        const stdout = result.stdout?.toString().trim() || '';
        const stderr = result.stderr?.toString().trim() || '';
        if (result.exitCode !== 0) return `AppleScript error: ${stderr || 'Unknown error'}`;
        return stdout || 'Command executed successfully (no output).';
    } catch (err: any) {
        return `AppleScript execution failed: ${err.message}`;
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
            title: { type: 'string', description: 'Notification title', required: true },
            message: { type: 'string', description: 'Notification body', required: true }
        },
        execute: async (params) => {
            const p = params as any;
            const script = `display notification "${(p.message || '').replace(/"/g, '\\"')}" with title "${(p.title || '').replace(/"/g, '\\"')}"`;
            return runAppleScript(script);
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
    }
];

export function registerAppleScriptTools() {
    appleScriptTools.forEach(tool => toolRegistry.register(tool));
    console.log('[APPLESCRIPT] macOS Mail, Calendar, and Notification tools registered.');
}
