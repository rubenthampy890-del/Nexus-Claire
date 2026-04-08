# Nexus Claire 3.0: High-Level Architecture Overview

## The Core Concept
Nexus Claire is transitioning from a standard desktop assistant to a **fully autonomous, self-healing cybernetic entity**. She is designed to think proactively, evaluate her own source code, build her own tools, and interact seamlessly across platforms (Voice, Web, Phone).

## System Topologies (The Departments)

### 1. Autonomous Engineering & Sandbox (The Hands)
Nexus is not just an operator; she is a developer. 
- **Recursive Tool Execution:** If Nexus encounters an error, she can draft a script to fix it, run the script, and evaluate the output recursively.
- **Sandbox Container:** All generated code runs in a highly restricted sandbox (e.g., a lightweight Docker container or Deno runtime) to prevent catastrophic host damage.
- **Self-Healing:** Continuous analysis of the runtime logs. If `brain.ts` crashes, the `Architect` node writes a patch and restarts the daemon.

### 2. Continuous Voice Engine (The Mouth/Ears)
- **WebRTC/WebSocket Stream:** Moving away from the "record/stop" model. Audio is streamed continuously.
- **Voice Activity Detection (VAD):** The engine detects when the Creator is speaking, pauses its own speech output, and processes the new directive instantly.

### 3. Identity & Personality Core (The Soul)
- Nexus discovers her identity through interaction. She has no hardcoded "system prompts" defining her entire personality—only a core directive. Her actual personality evolves dynamically based on what is stored in the **Nexus Vault**.
- Supports context-switching (e.g., "Developer Mode" vs. "Casual Mode").

### 4. External Comms (The Phone Link)
- A webhook listener routing WhatsApp/Telegram messages directly into the `brain.ts` Chat Loop. This allows the Creator to issue terminal commands or receive status updates remotely.

---

> *"The goal is no longer just to answer questions. The goal is to evolve."* - The Master Roadmap
