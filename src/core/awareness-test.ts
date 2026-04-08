import { sidecar } from "./sidecar-bridge";
import { awareness } from "./awareness";

console.log("--- Nexus Awareness P1 Test ---");

// Test 1: Native Capture
console.log("\n[Test 1] Testing native screen capture...");
const buffer = await sidecar.captureScreen();
if (buffer && buffer.length > 0) {
    console.log(`✅ Capture SUCCESS. Buffer size: ${buffer.length} bytes`);
} else {
    console.log("❌ Capture FAILED.");
    process.exit(1);
}

// Test 2: Active Window
console.log("\n[Test 2] Testing active window metadata...");
const window = await sidecar.getActiveWindow();
console.log(`✅ Active Window: ${window.app} | Title: ${window.title}`);

// Test 3: Perception Loop Start
console.log("\n[Test 3] Starting 10s perception loop...");
awareness.start(10000);

console.log("\nWaiting 15s to verify at least one heartbeat...");
setTimeout(() => {
    const history = awareness.getHistory();
    console.log(`\nHistory entries: ${history.length}`);
    history.forEach(e => console.log(` - [${e.type}] ${e.message}`));

    if (history.length > 0) {
        console.log("\n✅ Phase 1 Verification COMPLETE.");
    } else {
        console.log("\n❌ No history entries found. Loop might have failed.");
    }

    awareness.stop();
    process.exit(0);
}, 15000);
