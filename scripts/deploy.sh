#!/bin/bash
# ╔══════════════════════════════════════════════════════╗
# ║   NEXUS CLAIRE — Universal Deployment Script         ║
# ║   Works on: VPS, Colab, HF Spaces, Docker, Mac/Linux║
# ╚══════════════════════════════════════════════════════╝
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/deploy.sh | bash
#   OR: bash deploy.sh
#
# Environment: Set these before running (or create a .env file):
#   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, GEMINI_API_KEY, etc.

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${CYAN}[NEXUS]${NC} $1"; }
ok()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn(){ echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; }

# ─── Detect Platform ───
detect_platform() {
    if [ -f /proc/version ] && grep -qi "google" /proc/version 2>/dev/null; then
        echo "colab"
    elif [ -n "$SPACE_ID" ] || [ -n "$HF_SPACE" ]; then
        echo "huggingface"
    elif [ -f /.dockerenv ]; then
        echo "docker"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "mac"
    else
        echo "linux"
    fi
}

PLATFORM=$(detect_platform)
log "Detected platform: ${GREEN}${PLATFORM}${NC}"

# ─── Step 1: Install Bun ───
install_bun() {
    if command -v bun &>/dev/null; then
        ok "Bun already installed: $(bun --version)"
        return
    fi

    log "Installing Bun runtime..."
    case $PLATFORM in
        colab)
            # Colab runs as root, direct install
            curl -fsSL https://bun.sh/install | bash
            export BUN_INSTALL="$HOME/.bun"
            export PATH="$BUN_INSTALL/bin:$PATH"
            ;;
        huggingface|docker|linux)
            curl -fsSL https://bun.sh/install | bash
            export BUN_INSTALL="$HOME/.bun"
            export PATH="$BUN_INSTALL/bin:$PATH"
            ;;
        mac)
            if command -v brew &>/dev/null; then
                brew install oven-sh/bun/bun
            else
                curl -fsSL https://bun.sh/install | bash
                export BUN_INSTALL="$HOME/.bun"
                export PATH="$BUN_INSTALL/bin:$PATH"
            fi
            ;;
    esac
    ok "Bun installed: $(bun --version)"
}

# ─── Step 2: Clone or Detect Repo ───
setup_repo() {
    if [ -f "package.json" ] && grep -q "nexus-claire" package.json 2>/dev/null; then
        ok "Nexus Claire repo detected in current directory."
        return
    fi

    if [ -d "Nexus-Claire" ]; then
        cd Nexus-Claire
        ok "Nexus Claire directory found."
        return
    fi

    warn "Nexus Claire not found. Please clone your repo first:"
    echo "  git clone https://github.com/YOUR_USERNAME/Nexus-Claire.git && cd Nexus-Claire"
    exit 1
}

# ─── Step 3: Install Dependencies ───
install_deps() {
    log "Installing dependencies..."
    bun install 2>/dev/null || bun install --no-frozen-lockfile
    ok "Dependencies installed."

    if [ -d "dashboard" ]; then
        log "Installing dashboard dependencies..."
        cd dashboard && bun install 2>/dev/null || npm install
        cd ..
        ok "Dashboard dependencies installed."
    fi
}

# ─── Step 4: Environment Setup ───
setup_env() {
    if [ -f ".env" ]; then
        ok ".env file found."
        return
    fi

    warn "No .env file found. Creating template..."
    cat > .env << 'EOF'
# ─── Nexus Claire Environment ───
# Fill in your API keys below

# Cloudflare Workers AI (Primary Inference)
CLOUDFLARE_ACCOUNT_ID=""
CLOUDFLARE_API_TOKEN=""

# Google AI (Fallback)
GEMINI_API_KEY=""

# Groq (Emergency Fallback)
GROQ_API_KEY=""

# Supabase (Cloud Memory - Optional)
SUPABASE_URL=""
SUPABASE_SERVICE_ROLE_KEY=""

# Telegram Bot (Optional)
TELEGRAM_BOT_TOKEN=""

# ElevenLabs Voice (Optional)
ELEVENLABS_API_KEY=""
EOF
    warn "Please edit .env with your API keys, then re-run this script."
    exit 0
}

# ─── Step 5: Start ───
start_nexus() {
    log "Starting Nexus Claire..."

    case $PLATFORM in
        colab)
            # Colab: Run brain only (no dashboard needed, use Colab's own UI)
            log "Colab mode: Starting Brain-only (WebSocket on port 18790)"
            log "Use the satellite or connect from a remote dashboard."
            bun run src/core/brain.ts &
            BRAIN_PID=$!
            echo ""
            ok "Nexus Brain running (PID: $BRAIN_PID)"
            ok "WebSocket: ws://localhost:18790"
            echo ""
            log "To expose publicly, run in another cell:"
            echo "  !npx localtunnel --port 18790"
            wait $BRAIN_PID
            ;;
        huggingface)
            # HF Spaces: Run brain with dashboard on port 7860 (HF default)
            log "HuggingFace Spaces mode: Dashboard on port 7860"
            export VITE_PORT=7860
            bun run start
            ;;
        *)
            # Standard: Full boot
            bun run start
            ;;
    esac
}

# ─── Main ───
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║     NEXUS CLAIRE — Universal Deployment              ║"
echo "║     Platform: ${PLATFORM}                              "
echo "╚══════════════════════════════════════════════════════╝"
echo ""

install_bun
setup_repo
install_deps
setup_env
start_nexus
