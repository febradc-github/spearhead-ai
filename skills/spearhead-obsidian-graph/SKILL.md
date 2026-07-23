---
name: spearhead-obsidian-graph
description: "Opens Obsidian directly to the graph view via the Advanced URI community plugin. Dispatched by /spearhead:obsidian-graph only."
user-invocable: false
---

# Obsidian Graph

<important>
- This only opens a URI; it cannot verify Obsidian actually reached the graph view. Opening a URI is fire-and-forget at the OS level, and the script's own output says so -- relay that limitation, don't paper over it.
- Two preconditions are the user's responsibility, not this skill's: Obsidian must be installed, and the Advanced URI community plugin must be installed and enabled in the vault. Do not attempt to install either.
</important>

## Process

1. Run `node "$CLAUDE_PLUGIN_ROOT/scripts/obsidian-graph.js"`.
2. Relay its output verbatim to the user, including the stated preconditions and the fire-and-forget limitation.
3. If the script exits non-zero (unsupported platform, or the platform-open command failed to spawn), make clear that auto-open did not happen and that the printed `obsidian://` URI can be opened manually instead.
