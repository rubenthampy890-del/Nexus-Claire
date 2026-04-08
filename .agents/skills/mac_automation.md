# SKILL: Nexus Claire - Mac-Native AI Orchestration

## Description
Advanced patterns for controlling macOS and orchestrating real-time AI agents through a Bun/TypeScript brain.

## Instructions
1. **Always use AppleScript** for deep application control where native APIs are missing.
2. **Prefer Bun's `spawnSync`** for low-latency CLI interactions (screencapture, adb).
3. **Implement Subsumption Architecture**: Ensure Layer 0 (Audio/Voice) has priority over Layer 3 (Background Research).
4. **Memory Management**: Every action must be recorded in the SQLite-based "Vault" Knowledge Graph before completion.
5. **UI Consistency**: Use the "Liquid Glass" design system (Glassmorphism, HSL tailwind colors, micro-animations).

## Examples
### Native Screen Capture in Bun
```typescript
const capture = Bun.spawnSync(["screencapture", "-x", "temp.png"]);
```

### AppleScript App Launch
```typescript
const launch = Bun.spawnSync(["osascript", "-e", 'tell application "System Events" to launch application "Calendar"']);
```
