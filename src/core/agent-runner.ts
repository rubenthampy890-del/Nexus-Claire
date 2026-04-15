import { AgentInstance, type Message } from "./orchestrator";
import { toolRegistry } from "./tool-registry";
import { inference } from "./inference";
import { engineer } from "../agents/engineer";
import { authorityEngine } from "./authority-engine";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type RunAgentOptions = {
    agent: AgentInstance;
    task: string;
    context?: string;
    maxIterations?: number;
    onProgress?: (progress: string) => void;
};

export type RunAgentResult = {
    success: boolean;
    response: string;
    toolsUsed: string[];
};

export async function runNexusAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
    const { agent, task, context, maxIterations = 20, onProgress } = opts;
    const toolsUsed: string[] = [];
    let totalTokens = 0;
    const MAX_TOKENS = agent.agent.role.max_token_budget || 100000;

    console.log(`[RUNNER] Launching agent ${agent.id} on task: ${task.slice(0, 100)}...`);

    // Initialize system prompt with tool schemas
    const toolDefinitions = agent.agent.authority.allowed_tools.map(tName => {
        const tool = toolRegistry.getTool(tName);
        if (!tool) return null;
        return {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        };
    }).filter(Boolean);

    const systemPrompt = `You are ${agent.agent.role.name}. 
Description: ${agent.agent.role.description}
Responsibilities: ${agent.agent.role.responsibilities.join(', ')}

Available Tools (Use EXACT names):
${agent.agent.authority.allowed_tools.join(', ')}

Tool Schemas:
${JSON.stringify(toolDefinitions, null, 2)}

Your goal is to solve the task autonomously using your tools.
CRITICAL INSTRUCTIONS:
1. AUTONOMY: Do not ask for permission. Do not explain what you are going to do. Just DO it using the tools.
2. REASONING MIRROR: Before each turn, if you decide NOT to use a tool, you must briefly state why in a <reasoning> block.
3. TOOL EXECUTION: To use a tool, output a JSON block exactly like this:
[TOOL: tool_name]
{
  "param1": "value"
}
[/TOOL]

4. MULTI-STEP: If a task requires multiple steps (like logging into Instagram), execute the first step (e.g., browser.navigate) then wait for the result.
6. VERIFICATION: You MUST verify any code change (fs.write, fs.patch) by running a relevant script or command via 'terminal.run'. Do not assume it works just because it was written.
7. CONTEXT PINNING: When you use 'fs.read', the file content is 'pinned' to your system context across iterations. This ensures you always see the core code even if the conversation history grows long. Use 'fs.patch' for large files to avoid truncation errors.`;

    agent.addMessage('system', systemPrompt);
    agent.addMessage('user', `Task: ${task}\n\nContext: ${context || 'None'}`);

    // Check for previous checkpoint for this task
    const checkpointPath = join(tmpdir(), `nexus-checkpoint-${agent.id}.json`);
    if (existsSync(checkpointPath)) {
        try {
            console.log(`[RUNNER] Found checkpoint for agent ${agent.id}. Resuming...`);
            const state = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
            agent.restoreCheckpoint(state);
            onProgress?.(`Indestructible Protocol: Resumed from checkpoint.`);
        } catch (e) {
            console.warn(`[RUNNER] Failed to load checkpoint: ${e}`);
        }
    }

    for (let i = 0; i < maxIterations; i++) {
        console.log(`[RUNNER] Iteration ${i + 1}/${maxIterations} for agent ${agent.id}`);

        // Use unified InferenceService
        const response = await inference.chat(agent.getMessages());

        agent.addMessage('assistant', response);
        onProgress?.(`Iteration ${i + 1}: Received LLM response.`);


        // Parse for tool calls — supports dots and hyphens in tool names (e.g. fs.write, terminal.run)
        const toolMatch = response.match(/\[TOOL: ([\w\-\.]+)\]([\s\S]*?)\[\/TOOL\]/);
        if (toolMatch) {
            let toolName = toolMatch[1] || "";

            // --- Tool Alias Mapping ---
            const ALIAS_MAP: Record<string, string> = {
                'terminal': 'terminal.run',
                'execute_command': 'terminal.run',
                'filesystem': 'fs.list',
                'file_manager': 'fs.list',
                'read_file': 'fs.read',
                'write_file': 'fs.write',
                'patch_file': 'fs.patch',
                'search_code': 'fs.search',
                'delete_file': 'fs.delete',
                'nexus_core': 'system.info',
                'system_info': 'system.info'
            };

            if (!toolRegistry.getTool(toolName) && ALIAS_MAP[toolName]) {
                const alias = ALIAS_MAP[toolName] as string;
                if (agent.agent.authority.allowed_tools.includes(alias)) {
                    console.log(`[RUNNER] Mapping alias '${toolName}' -> '${alias}'`);
                    toolName = alias;
                }
            }

            let toolParams = {};
            try {
                const paramsRaw = (toolMatch[2] || "{}").trim();

                // Extremely robust extraction: search for the first '{' and last '}'
                const firstBrace = paramsRaw.indexOf('{');
                const lastBrace = paramsRaw.lastIndexOf('}');

                if (firstBrace !== -1 && lastBrace !== -1) {
                    const jsonCandidate = paramsRaw.slice(firstBrace, lastBrace + 1);
                    toolParams = JSON.parse(jsonCandidate);
                } else if (paramsRaw === "" || paramsRaw === "{}") {
                    toolParams = {};
                } else {
                    // Fallback to direct parse if no braces found
                    toolParams = JSON.parse(paramsRaw);
                }
            } catch (e) {
                console.error(`[RUNNER] Failed to parse tool params for ${toolName}:`, toolMatch[2]);
                agent.addMessage('user', `Error: Failed to parse tool parameters for ${toolName}. Please ensure you output valid JSON.`);
                continue;
            }

            if (!agent.agent.authority.allowed_tools.includes(toolName)) {
                agent.addMessage('user', `Error: You are not authorized to use the tool '${toolName}'.`);
                continue;
            }

            // --- Phase 2: Authority & Execution ---
            // Registry.executeTool handles the Authority Gate (Critic) and Approval Wait.
            const rawToolResult = await toolRegistry.executeTool(toolName, toolParams, { agentId: agent.id });

            // --- Phase 29: Autonomous Handover ---
            const toolDef = toolRegistry.getTool(toolName);
            if (!rawToolResult.startsWith('Error:') && toolDef && (toolDef.failureCount ?? 0) >= 3) {
                console.log(`[RUNNER] 🚨 HEALING REQUIRED: Agent ${agent.id} is stuck in a failure loop with ${toolName}.`);
                onProgress?.(`Agent stuck with ${toolName}. Summoning Engineer for self-repair...`);

                const repairTask = `Agent ${agent.agent.role.name} is failing to execute ${toolName} with params: ${JSON.stringify(toolParams)}. 
                Error state: ${rawToolResult}. 
                The objective was: ${task}. 
                Repair the system or environment so the agent can proceed.`;

                await engineer.executeTask(repairTask, `REPAIR:${agent.id}`);
                agent.addMessage('user', `[SYSTEM] The Engineer has attempted a self-repair of the system state for ${toolName}. Proceed with caution.`);
                continue;
            }

            // --- Phase 27: Tool Self-Correction ---
            const isFailure = rawToolResult.startsWith('Error:');
            const hint = toolRegistry.getFailureHint(toolName);

            if (isFailure && hint) {
                console.warn(`[RUNNER] 🔧 Tool ${toolName} failed. Injecting correction hint...`);
                agent.addMessage('user', `Tool Result (${toolName}):\n${rawToolResult}\n\n[SYSTEM HINT] You may have used incorrect parameters. ${hint}\nEvaluate the error and retry with the correct parameters.`);
                onProgress?.(`Tool ${toolName} failed. Injected correction hint.`);
                continue; // Immediate retry in next iteration
            }

            // --- AUTO-PINNING LOGIC (Phase 17) ---
            if (toolName === 'fs.read' && !rawToolResult.startsWith('Error:')) {
                const filePath = (toolParams as any).path;
                agent.pinContext(`FILE: ${filePath}`, rawToolResult);
            } else if ((toolName === 'fs.write' || toolName === 'fs.patch') && !rawToolResult.startsWith('Error:')) {
                // If we edit a file, the pin might be stale.
                // We could unpin or re-read. For now, unpin to force a re-read if needed.
                const filePath = (toolParams as any).path;
                agent.unpinContext(`FILE: ${filePath}`);
            }

            toolsUsed.push(toolName);

            // Truncate tool results for history safety (max 12k chars)
            const truncatedResult = rawToolResult.length > 12000
                ? `${rawToolResult.slice(0, 12000)}\n\n[... Output truncated due to length ...]`
                : rawToolResult;

            agent.addMessage('user', `Tool Result (${toolName}):\n${truncatedResult}`);
            onProgress?.(`Executed tool: ${toolName}`);

            // --- CHECKPOINTING (Every 5 iterations or on mission-critical success) ---
            if ((i + 1) % 5 === 0 || toolName.startsWith('fs.')) {
                try {
                    const state = {
                        ...agent.getCheckpointState(),
                        iteration: i
                    };
                    writeFileSync(checkpointPath, JSON.stringify(state, null, 2));
                    console.log(`[RUNNER] Checkpoint saved for agent ${agent.id} at iteration ${i + 1}`);
                } catch (e) { }
            }
        } else {
            // No tool calls - task might be done
            console.log(`[RUNNER] Agent ${agent.id} completed task.`);
            return {
                success: true,
                response,
                toolsUsed
            };
        }
    }

    return {
        success: false,
        response: "Error: Maximum iterations reached without completion.",
        toolsUsed
    };
}
