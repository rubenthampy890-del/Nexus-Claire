#!/bin/bash
# ╔═══════════════════════════════════════════════╗
# ║  NEXUS CLAIRE — Google Colab Quick Start       ║
# ╚═══════════════════════════════════════════════╝
#
# Paste this entire block into a Colab cell:
#
# !bash colab_start.sh
#
# Or run each section in separate cells.

echo "🧠 Installing Bun runtime..."
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
echo "✅ Bun $(bun --version) installed"

echo ""
echo "📦 Installing dependencies..."
bun install
echo "✅ Dependencies ready"

echo ""
echo "🔑 Setting up environment..."
# ─── EDIT THESE WITH YOUR KEYS ───
export CLOUDFLARE_ACCOUNT_ID="YOUR_CF_ACCOUNT_ID"
export CLOUDFLARE_API_TOKEN="YOUR_CF_API_TOKEN"
export GEMINI_API_KEY="YOUR_GEMINI_KEY"
export GROQ_API_KEY="YOUR_GROQ_KEY"

echo ""
echo "🚀 Starting Nexus Claire Brain..."
echo "   WebSocket will be on port 18790"
echo "   Use localtunnel to expose: npx localtunnel --port 18790"
echo ""

bun run src/core/brain.ts
