import { config } from "dotenv";
import { join } from "path";

// Load environment variables
config({ path: join(import.meta.dir, "../.env") });

const accounts = [
    { name: "Account 1", id: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN },
    { name: "Account 2", id: process.env.CLOUDFLARE_ACCOUNT_ID_2, token: process.env.CLOUDFLARE_API_TOKEN_2 },
    { name: "Account 3", id: process.env.CLOUDFLARE_ACCOUNT_ID_3, token: process.env.CLOUDFLARE_API_TOKEN_3 },
    { name: "Account 4", id: process.env.CLOUDFLARE_ACCOUNT_ID_4, token: process.env.CLOUDFLARE_API_TOKEN_4 },
];

async function testAccount(account: typeof accounts[0]) {
    if (!account.id || !account.token) {
        return { name: account.name, status: "MISSING", error: "Missing ID or Token" };
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${account.id}/ai/run/@cf/meta/llama-2-7b-chat-int8`;

    try {
        const start = Date.now();
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${account.token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messages: [{ role: "user", content: "Ping" }],
                max_tokens: 5
            }),
        });
        const duration = Date.now() - start;

        if (response.ok) {
            return { name: account.name, status: "ONLINE", latency: `${duration}ms` };
        } else {
            const errorData: any = await response.json();
            return { name: account.name, status: "ERROR", code: response.status, error: errorData.errors?.[0]?.message || "Unknown error" };
        }
    } catch (err: any) {
        return { name: account.name, status: "FAILED", error: err.message };
    }
}

async function main() {
    console.log("\n   CLOUD INTELLIGENCE DIAGNOSTICS");
    console.log("   ──────────────────────────────");

    const results = await Promise.all(accounts.map(testAccount));

    results.forEach(res => {
        let statusColor = "\x1b[31m"; // Red
        if (res.status === "ONLINE") statusColor = "\x1b[32m"; // Green

        console.log(`     ○ ${res.name}....... ${statusColor}${res.status}\x1b[0m`);
        if (res.latency) console.log(`       └ Latency: ${res.latency}`);
        if (res.error) console.log(`       └ Error: ${res.error}`);
    });

    console.log("\n   ──────────────────────────────\n");
}

main();
