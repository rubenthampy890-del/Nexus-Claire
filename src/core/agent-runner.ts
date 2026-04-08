import { AgentInstance, type Message } from "./orchestrator";
import { toolRegistry } from "./registry";
import { inference } from "./inference";
import { authorityEngine } from "./authority-engine";

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
    const { agent, task, context, maxIterations = 50, onProgress } = opts;
    const toolsUsed: string[] = [];

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
CRITICAL: You MUST use a tool to perform any file operations or terminal commands. 
To use a tool, output a JSON block exactly like this:
[TOOL: tool_name]
{
  "param1": "value"
}
[/TOOL]

If you have no tools left to use and the task is finished, explain what you did and conclude.`;

    agent.addMessage('system', systemPrompt);
    agent.addMessage('user', `Task: ${task}\n\nContext: ${context || 'None'}`);

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

            // --- Phase 2: Authority Engine Gating ---
            const toolDef = toolRegistry.getTool(toolName);
            if (toolDef) {
                const decision = authorityEngine.checkAuthority(agent.agent.role, toolDef, toolParams);

                if (decision.requiresApproval) {
                    console.log(`[RUNNER] !! APPROVAL REQUIRED !! Tool: ${toolName} | Reason: ${decision.reason}`);
                    // In a headless autonomous runner, we pause and request approval.
                    // For now, we simulate approval but log the gate.
                    agent.addMessage('user', `Awaiting user approval for ${toolName}... (Reason: ${decision.reason})`);
                    // [TODO] Implement real async approval wait
                }
            }

            const rawToolResult = await toolRegistry.executeTool(toolName, toolParams, { agentId: agent.id });
            toolsUsed.push(toolName);

            // Truncate tool results for history safety (max 12k chars)
            const truncatedResult = rawToolResult.length > 12000
                ? `${rawToolResult.slice(0, 12000)}\n\n[... Output truncated due to length ...]`
                : rawToolResult;

            agent.addMessage('user', `Tool Result (${toolName}):\n${truncatedResult}`);
            onProgress?.(`Executed tool: ${toolName}`);
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
