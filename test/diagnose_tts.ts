import { VoiceEngine } from "./src/core/voice";
import { writeFileSync } from "fs";

async function test() {
    console.log("Synthesizing test audio...");
    const buffer = await VoiceEngine.synthesize("Hello! This is a test from Nexus Claire. If you can hear this, the voice engine is working correctly.");
    if (buffer.length > 0) {
        console.log(`Success! Synthesized ${buffer.length} bytes.`);
        writeFileSync("test_audio.mp3", buffer);
        console.log("Audio saved to test_audio.mp3. You can play it to verify.");
    } else {
        console.error("Failed! Synthesized buffer is empty.");
    }
    process.exit(0);
}

test();
