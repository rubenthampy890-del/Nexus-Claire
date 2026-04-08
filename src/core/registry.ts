/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — TOOL REGISTRY (Backwards Compatibility)    ║
 * ║       Now re-exports from tool-registry.ts v2.0                 ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * This file maintains backwards compatibility for existing imports:
 *   import { toolRegistry, ToolDefinition, ToolParameter } from "./registry"
 *
 * All functionality now lives in tool-registry.ts (OpenClaw-inspired).
 */

export {
    NexusToolRegistry as ToolRegistry,
    toolRegistry,
    type ToolDefinition,
    type ToolParameter,
    type ToolProvenance,
    type ToolRiskLevel,
    type ToolExecutionContext,
    type BeforeToolCallHook,
    type ToolCallDecision,
    type ToolExecutionEvent,
    type ToolEventListener,
} from "./tool-registry";
