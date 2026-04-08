import { NeuralLink } from "./link";

async function runPingTest() {
    console.log("=== NEXUS CLAIRE: NEURAL LINK PING TEST ===");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("❌ ERROR: GEMINI_API_KEY is not defined in the environment.");
        process.exit(1);
    }

    const testLink = new NeuralLink(apiKey);

    try {
        await testLink.connect();

        console.log("-> Sending test Ping...");
        setTimeout(() => {
            testLink.sendText("Hello! This is a system ping from the Nexus Claire testing framework. Are you online?");
        }, 2000); // Wait 2s for connection to fully stabilize

        // Keep the process alive for a few seconds to receive the response
        setTimeout(() => {
            console.log("\n=== END OF PING TEST ===");
            process.exit(0);
        }, 10000);

    } catch (e) {
        console.error("❌ Failed to run ping test.", e);
        process.exit(1);
    }
}

runPingTest();
