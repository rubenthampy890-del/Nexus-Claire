# SKILL: Nexus Claire - Bun/TypeScript Agentic Patterns

## Description
High-performance agent orchestration using the Bun runtime and TypeScript.

## Instructions
1. **Leverage Bun's built-in SQLite**: Use `bun:sqlite` for all local memory operations to minimize latency.
2. **WebSocket Efficiency**: All audio/voice data should be handled via binary WebSocket streams to the Gemini Live API.
3. **Type-Safe Tools**: Every agentic tool must have a strict TypeScript interface definition.
4. **Hot-Reloading**: Design the "Skills Registry" to support dynamic importing of tool modules without daemon restart.

## Examples
### Sub-Agent Delegation
```typescript
import { AgentManager } from './core/agents';
const researcher = AgentManager.spawn('Researcher');
const results = await researcher.pursueGoal('Deep dive into MIT Subsumption Architecture');
```
