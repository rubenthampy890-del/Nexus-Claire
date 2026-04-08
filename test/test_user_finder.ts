import { userFinder } from "./src/core/user-finder";

console.log("=== Testing Nexus User Finder ===");

// We'll set dummy channels for Dashboard and Telegram, but the Desktop Notification (Level 1) 
// uses osascript natively in the class, so we should actually see/hear it!
userFinder.setChannels({
    dashboard: (type, data) => console.log(`[DASHBOARD MOCK] Broadcast: ${type}`, data),
    telegram: (text) => console.log(`[TELEGRAM MOCK] Sent high-priority message: \n${text}`),
    voice: async (text) => { console.log(`[VOICE MOCK] Speaking: "${text}"`); }
});

// Configure cooldowns to be very fast for testing (2 seconds between levels)
userFinder.configure({ cooldownMs: 2000 });

async function runTest() {
    console.log("\n--- Initiating Critical Outreach ---");
    // Urgent starts at level 2 (Telegram), so let's test a normal one to see it escalate 0 -> 1 -> 2 -> 3
    await userFinder.findUser("The central database has lost connection. Immediate action required.", "normal");

    // Let it escalate all the way to Level 3 (Voice)
    // 0s => Level 0 (Dashboard)
    // 2s => Level 1 (Desktop Notification)
    // 4s => Level 2 (Telegram)
    // 6s => Level 3 (Voice)

    setTimeout(() => {
        console.log("\n--- Checking attempts array ---");
        console.dir(userFinder.getAttempts(), { depth: null });

        console.log("\n--- Acknowledging the alert ---");
        userFinder.acknowledge();

        console.log("\n✅ Test Complete.");
        process.exit(0);
    }, 8000);
}

runTest();
