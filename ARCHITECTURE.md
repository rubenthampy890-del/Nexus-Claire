# Nexus Claire 4.0: System Architecture

## Overview
Nexus Claire is a state-of-the-art modular autonomous agent framework designed to function as an "OS-level" ambient intelligence. The architecture features an isolated, server-side Node/Bun execution environment communicating over high-speed WebSockets to a React/Vite frontend dashboard. The agent consists of a multi-tier 'Swarm' with rigid execution domains, unified via the OpenClaw Zero-Hallucination Framework.

## 1. Multi-Agent Topology
The system delegates complex tasks across three primary autonomous agents:
- **NexusArchitect (Planner):** Defines strategy and breaks the user's objective into smaller `ToolExecution` trees. Handles failure loops by rethinking state.
- **NexusCoder (Executor):** Runs shell commands, reads files, and writes code. Physically cannot execute without the strict approval of a Tool Factory/Critic gate.
- **NexusBridge (Vision/Awareness):** A daemon that runs `screencapture`/OS commands on an interval, feeding current screen vision to Gemini 1.5 Pro to understand dynamic context.

## 2. OpenClaw Guard & Execution Gates
The **Critic Tier** enforces safety. The Architect specifies an intent, but before ANY tool execution hits the local OS, the `nexusCritic` tests the plan against specific rules (e.g., verifying if the targeted Unix bin exists, catching circular logic).

## 3. Persistent Memory Vault
Data retrieval relies heavily on an SQLite-backed `Vault`. Known entities, commands, or user preferences are embedded as "Facts", reducing prompt sizes while maintaining rich personalized context.

## 4. Omni-Channel Presence
Rather than waiting for input on a dashboard, the framework relies on dynamic proactive escalation using:
1. Local WebSocket pushes (Dashboard)
2. Telegram Bot Hooks
3. Text-to-Speech Interruption via ElevenLabs (Push-to-Talk)

## Environment Validation
The stack requires Cloudflare Workers AI for rapid, free swarm reasoning; Gemini API for screen comprehension; and Groq for blazing fast STT decoding. These are strictly validated via Zod on startup in `nexus.ts`.
