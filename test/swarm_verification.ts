import { WebSocket } from "ws";

async function verifySwarm() {
    console.log("🧪 STARTING SWARM VERIFICATION...");
    const ws = new WebSocket("ws://localhost:18790");

    ws.on("open", () => {
        console.log("✅ Connected to Neural Core.");

        // 1. Register as a Satellite
        ws.send(JSON.stringify({
            type: "SATELLITE_REGISTER",
            payload: { id: "Satellite-Alpha-Test" }
        }));
    });

    ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        console.log(`📩 Received from Brain: ${msg.type}`);

        if (msg.type === "SATELLITE_TASK_ASSIGN") {
            console.log("🎯 TASK RECEIVED:", msg.payload.description);

            // 2. Simulate task execution and send result
            setTimeout(() => {
                ws.send(JSON.stringify({
                    type: "SATELLITE_TASK_RESULT",
                    payload: {
                        taskId: msg.payload.taskId,
                        status: "complete",
                        success: true,
                        result: "Sample research completed: Swarm is 100% operational."
                    }
                }));
                console.log("✅ Result sent back to Brain.");
                setTimeout(() => process.exit(0), 1000);
            }, 2000);
        }
    });

    ws.on("error", (err) => {
        console.error("❌ WS Error:", err.message);
        process.exit(1);
    });

    // Timeout if nothing happens
    setTimeout(() => {
        console.error("❌ TIMEOUT: No task received from swarm.");
        process.exit(1);
    }, 15000);
}

verifySwarm();
