# Zed-style keyboard shortcuts

Shortcuts are **off by default**, so none of your existing VS Code key bindings change.

Turn on `zedLayout.keymap.enabled` to get Zed-style shortcuts for the extension's commands
(new agent session, switching between sessions, reviewing changes…). Turn it off again at any
time — nothing else is modified. The full list of shortcuts for Windows, Linux and macOS is in
[docs/KEYMAP.md](https://github.com/tarze07/vsc-zed-plugin/blob/main/docs/KEYMAP.md).

You can always bind any `zedLayout.*` command yourself in **Preferences: Open Keyboard
Shortcuts**, for example a shortcut that starts a specific agent:

```json
{ "key": "ctrl+alt+c", "command": "zedLayout.agents.newSession", "args": "claude" }
```

[Open Keymap Setting](command:workbench.action.openSettings?%5B%22zedLayout.keymap.enabled%22%5D)
