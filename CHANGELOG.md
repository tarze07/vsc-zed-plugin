# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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

## [0.0.1] - 2026-11-04

### Added

- Initial extension skeleton (M0): TypeScript + esbuild build, ESLint, Prettier.
- Sample command `Zed Layout: Hello` (`zedLayout.hello`) and setting `zedLayout.enabled`.
- Placeholder modules: `layout`, `theme`, `agents`, `worktrees`, `review`, `views`.
- Integration tests with `@vscode/test-cli` and `@vscode/test-electron`.
