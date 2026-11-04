# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- `Zed Layout: Apply Zed Layout` / `Restore Previous Layout` with settings backup, User/Workspace scope and confirmation (#4).
- `Zed-like Dark` and `Zed-like Light` color themes with WCAG AA contrast tests (#5).
- Typography settings `zedLayout.typography.*` applied by the layout preset (#5).
- `test:unit`, `themes:generate`, `themes:contrast` npm scripts.

## [0.0.1] - 2026-11-04

### Added

- Initial extension skeleton (M0): TypeScript + esbuild build, ESLint, Prettier.
- Sample command `Zed Layout: Hello` (`zedLayout.hello`) and setting `zedLayout.enabled`.
- Placeholder modules: `layout`, `theme`, `agents`, `worktrees`, `review`, `views`.
- Integration tests with `@vscode/test-cli` and `@vscode/test-electron`.
