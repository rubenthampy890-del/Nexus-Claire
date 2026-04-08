import { config } from "dotenv";
import { lookup } from "dns/promises";
config();

const cfAccounts = [
    { id: "Account 1", accountId: process.env.CLOUDFLARE_ACCOUNT_ID, apiToken: process.env.CLOUDFLARE_API_TOKEN },
    { id: "Account 2", accountId: process.env.CLOUDFLARE_ACCOUNT_ID_2, apiToken: process.env.CLOUDFLARE_API_TOKEN_2 },
    { id: "Account 3", accountId: process.env.CLOUDFLARE_ACCOUNT_ID_3, apiToken: process.env.CLOUDFLARE_API_TOKEN_3 },
    { id: "Account 4", accountId: process.env.CLOUDFLARE_ACCOUNT_ID_4, apiToken: process.env.CLOUDFLARE_API_TOKEN_4 }
].filter(acc => acc.accountId && acc.apiToken);

async function testAccount(account: any, resolvedIp: string) {
    const modelId = "@cf/meta/llama-3-8b-instruct";
    // Using IP + Host header to bypass DNS issues
    const url = `https://${resolvedIp}/client/v4/accounts/${account.accountId}/ai/run/${modelId}`;

    console.log(`[TEST] Testing ${account.id} via ${resolvedIp}...`);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${account.apiToken}`,
                "Content-Type": "application/json",
                "Host": "api.cloudflare.com"
            },
            body: JSON.stringify({
                messages: [{ role: "user", content: "Ping" }],
                stream: false
            })
        });

        if (!response.ok) {
            console.error(`[FAIL] ${account.id}: HTTP ${response.status}`);
            const errorData: any = await response.json().catch(() => ({}));
            console.error(`       Details: ${JSON.stringify(errorData)}`);
            return false;
        }

        const data: any = await response.json();
        const result = data.result?.choices?.[0]?.message?.content || data.result?.response;

        if (result) {
            console.log(`[PASS] ${account.id}: Response received.`);
            return true;
        } else {
            console.error(`[FAIL] ${account.id}: Empty response.`);
            return false;
        }
    } catch (err: any) {
        console.error(`[FAIL] ${account.id}: ${err.message}`);
        return false;
    }
}

async function runTests() {
    console.log(`[SWARM] Starting verification for ${cfAccounts.length} accounts...`);

    let resolvedIp = "";
    try {
        const addr = await lookup("api.cloudflare.com");
        resolvedIp = addr.address;
        console.log(`[DNS] Resolved api.cloudflare.com to ${resolvedIp}`);
    } catch (err: any) {
        console.error(`[DNS FAIL] Could not resolve api.cloudflare.com: ${err.message}`);
        return;
    }

    let passCount = 0;
    for (const acc of cfAccounts) {
        const passed = await testAccount(acc, resolvedIp);
        if (passed) passCount++;
    }

    console.log(`\n[SUMMARY] ${passCount}/${cfAccounts.length} accounts passed.`);
}

runTests();
