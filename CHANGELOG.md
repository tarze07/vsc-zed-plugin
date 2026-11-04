# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Session persistence: agent sessions are saved per workspace, terminals restored after a window reload are re-attached, and sessions that could not be restored can be resumed or forgotten (`zedLayout.sessions.restoreOnStartup`) (#16).
- Orphaned agent worktrees: listed in the Agents view with Start Session / Open / Review / Remove, bulk `Clean Up Agent Worktrees...`, base ref recorded at creation (`zedLayout.worktrees.showOrphaned`) (#16).

### Changed

- The extension activates on startup (`onStartupFinished`) to re-attach restored sessions (#16).

### Fixed

- Exit of an agent that was already running before a window reload is now detected (#16).

## [0.1.0] - 2026-11-04

First preview release.

### Added

- `Zed Layout: Apply Zed Layout` / `Restore Previous Layout` with settings backup, User/Workspace scope and confirmation (#4).
- `Zed-like Dark` and `Zed-like Light` color themes with WCAG AA contrast tests (#5).
- Typography settings `zedLayout.typography.*` applied by the layout preset (#5).
- `test:unit`, `themes:generate`, `themes:contrast` npm scripts.
- Agent registry (`zedLayout.agents`, defaults: Claude Code, Codex, Agy, Kilo Code) and `New Agent Session` opening agents as editor-tab terminals (#6).
- Agents view with per-status icons, session actions and an attention badge (#7).
- Session status detection via shell integration (`starting` / `running` / `waiting` / `exited`) with notifications (#8).
- Agent Changes view: per-session changes vs base, multi-diff, accept (stage) / reject (revert to base) per file, selection or all, commit, merge agent branch into base (#10).
- VS Code profile export: `profiles/zed-like.code-profile` and command `Save Zed Layout as Profile File...` (#13).
- Agent sessions in `git worktree`: create, open in new window, compare with base (multi-diff), safe removal (#9).
- Optional Zed-style keyboard shortcuts behind `zedLayout.keymap.enabled` (#11).
- Getting-started walkthrough, rewritten README with command/settings tables, user guide and FAQ (#12).
- Release automation: GitHub Release with `.vsix` and profile on `v*` tags, Marketplace / Open VSX publishing when tokens are configured, extension icon and Marketplace metadata (#14).

## [0.0.1] - 2026-11-04

### Added

- Initial extension skeleton (M0): TypeScript + esbuild build, ESLint, Prettier.
- Sample command `Zed Layout: Hello` (`zedLayout.hello`) and setting `zedLayout.enabled`.
- Placeholder modules: `layout`, `theme`, `agents`, `worktrees`, `review`, `views`.
- Integration tests with `@vscode/test-cli` and `@vscode/test-electron`.
