import { describe, it, expect, spyOn } from "bun:test";
import { awareness } from "../src/core/awareness";
import { taskManager } from "../src/core/task-manager";

describe("Nexus Awareness Service", () => {
    it("should trigger an autonomous research task when a struggle is reported", async () => {
        // Spy on taskManager.launch
        const launchSpy = spyOn(taskManager, 'launch');

        const struggleMessage = "CRITICAL ERROR: Connection to LLM failed after 3 retries.";

        awareness.reportEvent({
            type: 'struggle',
            source: 'InferenceEngine',
            message: struggleMessage,
            timestamp: Date.now()
        });

        // The awareness service uses an async loop, so we wait a bit
        await new Promise(r => setTimeout(r, 1000));

        expect(launchSpy).toHaveBeenCalled();
        const callArgs = launchSpy.mock.calls[0][0];
        expect(callArgs.task).toContain("struggle was detected");
        expect(callArgs.task).toContain(struggleMessage);
    });
});
