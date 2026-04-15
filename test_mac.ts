import { toolRegistry } from "./src/core/tool-registry";
import { registerAppleScriptTools } from "./src/core/tools/applescript";

async function testMac() {
    registerAppleScriptTools();
    const openApp = toolRegistry.getTool('mac.open_app');
    if (openApp) {
        console.log("-> Launching Calculator...");
        const result = await openApp.execute({ name: "Calculator" });
        console.log("Success:", result);
    } else {
        console.error("Tool mac.open_app not found.");
    }
}
testMac();
