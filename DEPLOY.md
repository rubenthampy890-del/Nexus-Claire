# 🧠 Nexus Claire — Deploy Anywhere

Nexus runs on **any platform with a CPU**. No GPU needed.

## Quick Start (Any Linux/Mac/VPS)
```bash
git clone https://github.com/YOUR_USERNAME/Nexus-Claire.git
cd Nexus-Claire
bash deploy.sh
```

---

## Platform Guides

### 🐳 Docker
```bash
# Full system
docker compose up --build -d

# Satellite worker only
docker build -f Dockerfile.satellite -t nexus-satellite .
docker run -d -e NEXUS_MAINFRAME_URL=ws://brain-host:18790 \
  -e CLOUDFLARE_ACCOUNT_ID=xxx -e CLOUDFLARE_API_TOKEN=xxx nexus-satellite
```

### 📓 Google Colab
```python
# Cell 1: Clone & install
!git clone https://github.com/YOUR_USERNAME/Nexus-Claire.git
%cd Nexus-Claire
!curl -fsSL https://bun.sh/install | bash
!export PATH="$HOME/.bun/bin:$PATH" && bun install && bun run src/core/brain.ts &

# Cell 2: Expose publicly
!npx -y localtunnel --port 18790
```

### 🤗 HuggingFace Spaces
1. New Space → SDK: **Docker**
2. Push this repo to the Space
3. Set Secrets: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `GEMINI_API_KEY`
4. Auto-deploys on port 7860

### 🚄 Railway / 🪰 Fly.io
Connect your GitHub repo → auto-detects Dockerfile → set env vars → deploy.

### 🖥️ Any VPS
```bash
ssh user@your-vps
git clone ... && cd Nexus-Claire
cp .env.example .env   # Edit keys
bash deploy.sh
```

---

## Architecture
```
┌──────────────┐  WS  ┌───────────────┐
│ Mac/VPS      │◄────►│ Cloud/Colab    │
│ (Mainframe)  │      │ (Satellite)    │
│ Brain + Dash │      │ satellite.ts   │
└──────┬───────┘      └───────────────┘
       │ Supabase
       ▼
┌──────────────┐
│ Cloud Memory │
└──────────────┘
```

## Required Environment Variables

| Variable | Required | Used By |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | Brain/Satellite |
| `CLOUDFLARE_API_TOKEN` | ✅ | Brain/Satellite |
| `GEMINI_API_KEY` | ✅ | Brain |
| `GROQ_API_KEY` | 🟡 | Brain (emergency) |
| `NEXUS_MAINFRAME_URL` | 🛰️ | Satellite only |
| `VITE_WS_URL` | 🌐 | Remote dashboard |
