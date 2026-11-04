# Configure your agents

Agents are command-line tools started in a terminal. Four are preconfigured in
`zedLayout.agents`:

| Agent       | Command    |
| ----------- | ---------- |
| Claude Code | `claude`   |
| Codex       | `codex`    |
| Agy         | `agy`      |
| Kilo Code   | `kilocode` |

Install the agents you use with their vendor's instructions and check that they start in a
regular terminal (for example `claude --version`). Agents that are not installed simply fail to
start with a clear message — you do not have to remove them.

**Not on PATH?** VS Code may not see directories added by your shell profile (nvm, asdf,
pipx…). Start VS Code from a terminal (`code .`) or set `command` to the full path.

Each entry supports `id`, `label`, `command`, `args`, `icon`, `color` and `env`, e.g.:

```json
{
  "id": "claude-opus",
  "label": "Claude (Opus)",
  "command": "claude",
  "args": ["--model", "opus"]
}
```

The setting replaces the whole list — copy the defaults before adding your own agent.

[Open Agent Settings](command:workbench.action.openSettings?%5B%22zedLayout.agents%22%5D)
