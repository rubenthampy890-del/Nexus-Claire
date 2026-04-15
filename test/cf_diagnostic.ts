import { config } from "dotenv";
import { join } from "path";

const ROOT = process.cwd();
config({ path: join(ROOT, ".env") });

async function testAccount(index: number, accountId: string, apiToken: string) {
    console.log(`\n[DIAGNOSTIC] Testing Account ${index} (ID: ${accountId.substring(0, 6)}...)...`);

    if (!accountId || !apiToken) {
        console.log(`[FAILED] Account ${index} credentials missing.`);
        return;
    }

    try {
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3-8b-instruct`,
            {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiToken}` },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: 'respond only with one word' },
                        { role: 'user', content: 'test' }
                    ]
                }),
            }
        );

        const data = await response.json() as any;

        if (response.status === 200 && data.success) {
            console.log(`[SUCCESS] Account ${index} is ACTIVE. Response: "${data.result.response}"`);
        } else if (response.status === 429 || (data.errors && data.errors.some((e: any) => e.code === 7013))) {
            console.log(`[DEPLETED] Account ${index} quota EXCEEDED (429/7013).`);
        } else {
            console.log(`[ERROR] Account ${index} returned status ${response.status}: ${JSON.stringify(data.errors)}`);
        }
    } catch (err: any) {
        console.log(`[FAILED] Account ${index} request error: ${err.message}`);
    }
}

console.log("=== CLOUDFLARE NEURON DIAGNOSTIC v2.0 ===");
console.log(`Timestamp: ${new Date().toISOString()}`);

const accounts = [
    { id: process.env.CLOUDFLARE_ACCOUNT_ID || "", token: process.env.CLOUDFLARE_API_TOKEN || "" },
    { id: process.env.CLOUDFLARE_ACCOUNT_ID_2 || "", token: process.env.CLOUDFLARE_API_TOKEN_2 || "" },
    { id: process.env.CLOUDFLARE_ACCOUNT_ID_3 || "", token: process.env.CLOUDFLARE_API_TOKEN_3 || "" },
    { id: process.env.CLOUDFLARE_ACCOUNT_ID_4 || "", token: process.env.CLOUDFLARE_API_TOKEN_4 || "" },
];

for (let i = 0; i < accounts.length; i++) {
    await testAccount(i + 1, accounts[i].id, accounts[i].token);
}

console.log("\n=== DIAGNOSTIC COMPLETE ===");
