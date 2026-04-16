import { toolRegistry, type ToolDefinition } from "../tool-registry";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

// Credentials
const user = process.env.NEXUS_EMAIL_USER;
const pass = process.env.NEXUS_EMAIL_PASS;

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass }
});

async function sendEmail(to: string, subject: string, body: string) {
    if (!user || !pass) return "Email provider not configured in .env (Needs NEXUS_EMAIL_USER & NEXUS_EMAIL_PASS)";
    try {
        const info = await transporter.sendMail({
            from: `"Nexus Claire" <${user}>`,
            to,
            subject,
            text: body,
        });
        return `Email sent successfully to ${to}. ID: ${info.messageId}`;
    } catch (e: any) {
        return `Failed to send email: ${e.message}`;
    }
}

async function readInbox(limit = 5) {
    if (!user || !pass) return "Email provider not configured in .env (Needs NEXUS_EMAIL_USER & NEXUS_EMAIL_PASS)";

    // ImapFlow is Promise-based and recommended for modern NodeJS IMAP
    const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user, pass },
        logger: false as any
    });

    try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        const mailbox = client.mailbox;
        if (!mailbox) {
            lock.release();
            await client.logout();
            return "Could not open INBOX.";
        }
        const count = typeof mailbox === 'object' && 'exists' in mailbox ? (mailbox as any).exists : 0;
        if (count === 0) {
            lock.release();
            await client.logout();
            return "Inbox is empty.";
        }

        const emails = [];
        const fetchRange = `${Math.max(1, count - limit + 1)}:*`;

        for await (let message of client.fetch(fetchRange, { source: true, uid: true })) {
            if (!message.source) continue;
            const parsed = await simpleParser(message.source as Buffer);
            emails.push({
                uid: message.uid,
                from: parsed.from?.text || 'Unknown Sender',
                subject: parsed.subject || 'No Subject',
                date: parsed.date?.toISOString() || 'Unknown Date',
                preview: parsed.text?.substring(0, 1500) + (parsed.text && parsed.text.length > 1500 ? "..." : "")
            });
        }
        lock.release();
        await client.logout();

        return JSON.stringify(emails.reverse(), null, 2);
    } catch (e: any) {
        return `Failed to read inbox: ${e.message}`;
    }
}

const emailTools: ToolDefinition[] = [
    {
        name: 'email.send',
        description: 'Send an email to a specific address. Useful for automated communications or sending reports.',
        category: 'communication',
        parameters: {
            to: { type: 'string', description: 'Recipient email address', required: true },
            subject: { type: 'string', description: 'Email subject', required: true },
            body: { type: 'string', description: 'Email body content (text)', required: true }
        },
        execute: async (params) => {
            const { to, subject, body } = params as any;
            console.log(`[EMAIL] ✉️ Sending email to ${to}...`);
            return await sendEmail(to, subject, body);
        }
    },
    {
        name: 'email.read_inbox',
        description: 'Read the latest recent emails from the inbox. Useful for grabbing OSINT requests or instructions.',
        category: 'communication',
        parameters: {
            limit: { type: 'number', description: 'Number of recent emails to fetch (default: 5, max: 20)', required: false }
        },
        execute: async (params) => {
            const limit = Math.min((params as any).limit || 5, 20);
            console.log(`[EMAIL] 📥 Reading ${limit} recent emails...`);
            return await readInbox(limit);
        }
    }
];

export function registerEmailTools() {
    emailTools.forEach(tool => toolRegistry.register(tool));
    console.log('[EMAIL] Autonomous email tools registered.');
}
