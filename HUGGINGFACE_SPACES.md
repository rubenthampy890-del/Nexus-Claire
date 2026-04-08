---
title: Nexus Claire
emoji: 🧠
colorFrom: purple
colorTo: blue
sdk: docker
app_port: 7860
pinned: true
---

# Nexus Claire — Autonomous Sentinel Intelligence

Deploy Nexus Claire on HuggingFace Spaces using Docker.

## Setup
1. Create a new Space with **Docker** SDK
2. Copy this repo into the Space
3. Set the following **Secrets** in Space settings:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
   - `GEMINI_API_KEY`
   - `GROQ_API_KEY`
   - `SUPABASE_URL` (optional)
   - `SUPABASE_SERVICE_ROLE_KEY` (optional)

The dashboard will be available at your Space URL on port 7860.
