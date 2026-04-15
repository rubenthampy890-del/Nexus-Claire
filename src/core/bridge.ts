import { toolRegistry } from "./tool-registry";
import { NexusCLI } from "./cli-ui";

/**
 * Nexus Neural Bridge v1.1
 * Exposes a localized HTTP bridge for the Python Voice Agent.
 * Uses native Bun.serve() — no external dependencies.
 */

let brainRef: any = null;

export function setBrainRef(brain: any) {
    brainRef = brain;
}

export const startBridge = (port = 18791) => {
    NexusCLI.log(`Neural Bridge active on port ${port}`, "INFO");

    Bun.serve({
        port,
        async fetch(req) {
            const url = new URL(req.url);

            if (req.method === "POST" && url.pathname === "/chat") {
                try {
                    const { message } = await req.json() as any;
                    NexusCLI.log(`[BRIDGE] Voice message received: "${message?.substring(0, 30)}..."`, "INFO");

                    if (brainRef) {
                        const response = await (brainRef as any).architect.sequence(message, 'HIGH');
                        return new Response(JSON.stringify({ response }), {
                            headers: { "Content-Type": "application/json" }
                        });
                    }
                    return new Response(JSON.stringify({ error: "Brain not initialized" }), { status: 503 });
                } catch (err: any) {
                    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
                }
            }

            if (req.method === "POST" && url.pathname === "/tool") {
                try {
                    const { tool, args } = await req.json() as any;
                    NexusCLI.log(`[BRIDGE] Voice requested tool: ${tool}`, "INFO");
                    const result = await toolRegistry.executeTool(tool, args, { agentId: 'voice-agent' });
                    return new Response(JSON.stringify({ result }), {
                        headers: { "Content-Type": "application/json" }
                    });
                } catch (err: any) {
                    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
                }
            }

            if (req.method === "GET" && url.pathname === "/context") {
                try {
                    const goalSummary = brainRef ? (brainRef as any).goalManager.getContextForLLM() : "Brain not initialized.";
                    return new Response(JSON.stringify({ goals: goalSummary }), {
                        headers: { "Content-Type": "application/json" }
                    });
                } catch (err: any) {
                    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
                }
            }

            return new Response("Nexus Neural Bridge v1.1", { status: 200 });
        }
    });
};
