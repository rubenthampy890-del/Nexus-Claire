import { inference } from "./src/core/inference";

async function testGemma4() {
    console.log("=== NEXUS CLAIRE: GEMMA 4 NEURON TEST ===");

    const messages = [
        { role: 'user' as const, content: "Hello Gemma 4. You are the Architect of Nexus Claire. Perform a self-diagnostic. Are your tools (fs, terminal, applescript) now enforcing hard exceptions?" }
    ];

    try {
        console.log("-> Querying Gemma 4 (High Priority)...");
        const response = await inference.chat(messages, 'HIGH');

        console.log("\n[GEMMA 4 RESPONSE]:");
        console.log("-----------------------------------------");
        console.log(response);
        console.log("-----------------------------------------");

        console.log("\n✅ Inference Success. Telemetry synchronized.");
        process.exit(0);
    } catch (e: any) {
        console.error("❌ Gemma 4 Inference Failed:", e.message);
        process.exit(1);
    }
}

testGemma4();
