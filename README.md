# Nexus Claire

A modular, multi-agent AI system built with TypeScript and Bun. Nexus Claire orchestrates specialized AI agents for autonomous task execution, tool creation, and persistent memory — running on Cloudflare Workers AI, Google Gemini, and Groq as inference backends.

> **Status:** Active development · Solo project · Not production-ready

## What It Does

- **Multi-Agent Orchestration** — A brain loop delegates tasks to specialized agents (Architect, Coder, Engineer) with role-based YAML configs
- **3-Tier Inference Failover** — Primary: Cloudflare Workers AI (Gemma 4 26B), Fallback: Gemini 2.0 Flash, Emergency: Groq Llama 3.3 70B — with smart API key rotation across multiple accounts
- **Persistent Memory (Vault)** — SQLite + Supabase vector store with semantic search, synced to human-readable Obsidian Markdown files
- **Runtime Tool Factory** — The system can generate new TypeScript tools at runtime from AI-generated JSON specs, hot-loaded without restart
- **Critic Guard** — A verification layer that audits agent outputs before execution to reduce hallucinated or dangerous tool calls
- **Cross-Platform** — OS-aware shell abstractions for screen capture and system monitoring (macOS, Linux, Windows)
- **Real-Time Dashboard** — React + Vite frontend with WebSocket connection for live agent monitoring, memory browsing, and directive tracking

## Architecture

```
nexus.ts              → Process manager (boots brain + dashboard, auto-restarts on crash)
src/core/brain.ts     → Main reasoning loop (tool selection, agent delegation, memory retrieval)
src/core/inference.ts → 3-tier LLM router with API key rotation
src/core/vault.ts     → Hybrid memory (SQLite + Supabase + Obsidian sync)
src/core/critic.ts    → Output verification before execution
src/core/tool-factory.ts → Runtime tool generation
src/agents/           → Specialized agents (architect, coder, engineer, extractor)
dashboard/            → React frontend (Vite + WebSocket)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full system map.

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- API keys for at least one inference provider (Cloudflare Workers AI, Google AI Studio, or Groq)

## Setup

```bash
# Install dependencies
bun install

# Copy and fill in your API keys
cp .env.example .env

# Start the system (boots brain + dashboard)
bun run nexus.ts
```

The dashboard will be available at `http://localhost:5173`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Yes* | Cloudflare account for Workers AI |
| `CLOUDFLARE_API_TOKEN` | Yes* | Cloudflare API token |
| `GEMINI_API_KEY` | Yes* | Google AI Studio key (fallback + embeddings) |
| `GROQ_API_KEY` | No | Groq API key (emergency fallback) |
| `SUPABASE_URL` | No | Supabase project URL (for cloud memory sync) |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Supabase service role key |
| `ELEVENLABS_API_KEY` | No | ElevenLabs key (voice synthesis) |

\* At least one inference provider is required.

## Project Structure

```
├── nexus.ts                 # Entry point & process manager
├── src/
│   ├── core/                # Core systems (brain, inference, vault, tools)
│   ├── agents/              # Specialized AI agents
│   └── services/            # Background services (telemetry, bridges)
├── dashboard/               # React frontend
├── test/                    # Test files
├── scripts/                 # Utility scripts
├── roles/                   # Agent role definitions (YAML)
└── vault/                   # Obsidian-compatible memory vault
```

## Running Tests

```bash
# Type check
bun tsc --noEmit

# Run a specific test
bun run test/orchestration.test.ts
```

## Known Limitations

- Voice pipeline (ElevenLabs TTS + Groq STT) is functional but experimental
- The Gemini Live WebSocket integration (`link.ts`) is a prototype
- No automated test suite yet — test files are manual integration tests
- Dashboard requires the brain WebSocket server to be running

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Language:** TypeScript
- **LLM Providers:** Cloudflare Workers AI, Google Gemini, Groq
- **Memory:** SQLite (local) + Supabase (cloud vectors) + Obsidian (markdown sync)
- **Frontend:** React + Vite
- **Deployment:** Docker, Cloudflare Workers

## License

[MIT](./LICENSE)
