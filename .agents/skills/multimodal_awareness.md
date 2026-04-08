# SKILL: Nexus Claire - Multimodal Awareness & Interaction

## Description
Advanced protocols for real-time screen analysis and low-latency computer interaction.

## Instructions
1. **Screen Slicing**: For large monitors, slice the screenshot into high-resolution crops rather than resizing to maintain text legibility for the vision model.
2. **Action-Space Mapping**: Map vision-detected coordinates to native macOS screen coordinates (considering Retina scaling) before executing mouse clicks.
3. **Delta-Awareness**: Only process screen changes if significant pixel shifts are detected to save compute and API tokens.
4. **Coordinate Verification**: After any move/click action, wait 200ms and re-verify the element's position.

## Examples
### Retina Scaling Calculation
```typescript
const scaleFactor = 2.0; // Retrieve from system profile
const targetX = detectedX / scaleFactor;
const targetY = detectedY / scaleFactor;
```

### Vision-Prompt for UI Tasks
"Act as a meticulous macOS user. Identify the pixel coordinates of the [Submit] button in this crop. Return JSON: {x, y, confidence}."
