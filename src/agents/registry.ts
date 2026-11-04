/**
 * Agent registry (#6): validation of `zedLayout.agents`, shell command building with safe quoting,
 * unique session naming and PATH lookup. Pure module — no `vscode` import, so it can be unit-tested
 * with plain mocha.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentDefinition } from './types';

export const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

export interface ParsedAgents {
  agents: AgentDefinition[];
  errors: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeEntry(index: number, entry: unknown): string {
  const id = isPlainObject(entry) && typeof entry.id === 'string' ? ` ("${entry.id}")` : '';
  return `Agent #${index + 1}${id}`;
}

/**
 * Validates the raw `zedLayout.agents` value. Invalid entries and duplicate ids (the later entry
 * loses) are dropped; every problem is reported as a readable message in `errors`.
 */
export function parseAgents(raw: unknown): ParsedAgents {
  const agents: AgentDefinition[] = [];
  const errors: string[] = [];
  if (raw === undefined || raw === null) {
    return { agents, errors };
  }
  if (!Array.isArray(raw)) {
    errors.push('zedLayout.agents must be an array of agent definitions.');
    return { agents, errors };
  }
  const seen = new Set<string>();
  raw.forEach((entry: unknown, index) => {
    const where = describeEntry(index, entry);
    if (!isPlainObject(entry)) {
      errors.push(`${where}: expected an object with "id", "label" and "command".`);
      return;
    }
    const problems: string[] = [];
    const { id, label, command, args, icon, color, env } = entry;

    if (typeof id !== 'string' || !AGENT_ID_PATTERN.test(id)) {
      problems.push(
        '"id" must be a string of lowercase letters, digits, "-" or "_" (starting with a letter or digit)',
      );
    }
    if (typeof label !== 'string' || label.trim() === '') {
      problems.push('"label" must be a non-empty string');
    }
    if (typeof command !== 'string' || command.trim() === '') {
      problems.push('"command" must be a non-empty string');
    }
    if (args !== undefined && !(Array.isArray(args) && args.every((a) => typeof a === 'string'))) {
      problems.push('"args" must be an array of strings');
    }
    if (icon !== undefined && (typeof icon !== 'string' || icon.trim() === '')) {
      problems.push('"icon" must be a non-empty string (codicon id)');
    }
    if (color !== undefined && (typeof color !== 'string' || color.trim() === '')) {
      problems.push('"color" must be a non-empty string (theme color id)');
    }
    if (
      env !== undefined &&
      !(isPlainObject(env) && Object.values(env).every((v) => typeof v === 'string'))
    ) {
      problems.push('"env" must be an object with string values');
    }

    if (problems.length > 0) {
      errors.push(`${where}: ${problems.join('; ')}.`);
      return;
    }
    const agentId = id as string;
    if (seen.has(agentId)) {
      errors.push(`${where}: duplicate id "${agentId}" — entry ignored.`);
      return;
    }
    seen.add(agentId);

    const agent: AgentDefinition = {
      id: agentId,
      label: (label as string).trim(),
      command: (command as string).trim(),
    };
    if (args !== undefined) {
      agent.args = [...(args as string[])];
    }
    if (icon !== undefined) {
      agent.icon = (icon as string).trim();
    }
    if (color !== undefined) {
      agent.color = (color as string).trim();
    }
    if (env !== undefined) {
      agent.env = { ...(env as Record<string, string>) };
    }
    agents.push(agent);
  });
  return { agents, errors };
}

// ---------------------------------------------------------------------------------------------
// Shell quoting
// ---------------------------------------------------------------------------------------------

export type ShellFlavor = 'posix' | 'powershell' | 'cmd';

/**
 * Picks the quoting style for the terminal's shell. On Windows the default is PowerShell; cmd.exe
 * and POSIX shells (Git Bash, WSL, MSYS) are detected from the shell path when known.
 */
export function shellFlavor(platform: NodeJS.Platform, shellPath?: string): ShellFlavor {
  const base = (shellPath ?? '')
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.exe$/, '');
  if (platform !== 'win32') {
    return base === 'pwsh' || base === 'powershell' ? 'powershell' : 'posix';
  }
  if (base === 'cmd') {
    return 'cmd';
  }
  if (['bash', 'sh', 'zsh', 'fish', 'wsl'].includes(base)) {
    return 'posix';
  }
  return 'powershell';
}

const POSIX_SAFE = /^[A-Za-z0-9_\-+=.,/:@%]+$/;
const POWERSHELL_SAFE = /^[A-Za-z0-9_\-+=.,/:\\%]+$/;
const CMD_SAFE = /^[A-Za-z0-9_\-+=.,/:\\@$#{}[\]~]+$/;

/** POSIX single-quote escaping: `it's` → `'it'\''s'`. Safe words are left unquoted. */
export function quotePosix(value: string): string {
  if (POSIX_SAFE.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** PowerShell literal string: single quotes, embedded `'` doubled (also handles typographic quotes). */
export function quotePowerShell(value: string): string {
  if (POWERSHELL_SAFE.test(value)) {
    return value;
  }
  return `'${value.replace(/['‘’‚‛]/g, (q) => q + q)}'`;
}

/** cmd.exe: double quotes, embedded `"` doubled (best effort — cmd has no fully safe quoting). */
export function quoteCmd(value: string): string {
  if (CMD_SAFE.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

export function quoteArg(value: string, flavor: ShellFlavor): string {
  switch (flavor) {
    case 'posix':
      return quotePosix(value);
    case 'powershell':
      return quotePowerShell(value);
    case 'cmd':
      return quoteCmd(value);
  }
}

function quoteCommand(command: string, flavor: ShellFlavor): string {
  if (flavor === 'posix' && command.startsWith('~/')) {
    // Keep the tilde unquoted so the shell expands it.
    return `~/${quotePosix(command.slice(2))}`;
  }
  const quoted = quoteArg(command, flavor);
  // PowerShell treats a quoted string as an expression; the call operator runs it as a command.
  return flavor === 'powershell' && quoted !== command ? `& ${quoted}` : quoted;
}

/**
 * Command line sent to the agent's terminal. `platformOrFlavor` is a Node platform (`win32` →
 * PowerShell quoting, anything else → POSIX) or an explicit {@link ShellFlavor}.
 */
export function buildShellCommand(
  agent: Pick<AgentDefinition, 'command' | 'args'>,
  platformOrFlavor: NodeJS.Platform | ShellFlavor,
): string {
  const flavor: ShellFlavor =
    platformOrFlavor === 'posix' || platformOrFlavor === 'powershell' || platformOrFlavor === 'cmd'
      ? platformOrFlavor
      : shellFlavor(platformOrFlavor);
  return [
    quoteCommand(agent.command, flavor),
    ...(agent.args ?? []).map((a) => quoteArg(a, flavor)),
  ].join(' ');
}

// ---------------------------------------------------------------------------------------------
// Session naming
// ---------------------------------------------------------------------------------------------

/** `label`, then `label 2`, `label 3`, … — the first one not in `existingNames`. */
export function uniqueSessionName(label: string, existingNames: Iterable<string>): string {
  const taken = new Set(existingNames);
  if (!taken.has(label)) {
    return label;
  }
  for (let n = 2; ; n++) {
    const candidate = `${label} ${n}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// PATH lookup
// ---------------------------------------------------------------------------------------------

export interface ExecutableLookupOptions {
  platform?: NodeJS.Platform;
  /** Value of PATH (defaults to `process.env.PATH`). */
  pathEnv?: string;
  /** Value of PATHEXT, Windows only (defaults to `process.env.PATHEXT`). */
  pathExt?: string;
  /** Base directory for relative command paths such as `./bin/agent`. */
  cwd?: string;
  homeDir?: string;
  /** Returns true when the path is an executable file (injectable for tests). */
  isExecutable?: (filePath: string) => boolean;
}

export function defaultIsExecutable(filePath: string): boolean {
  try {
    if (!fs.statSync(filePath).isFile()) {
      return false;
    }
    if (process.platform !== 'win32') {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves `command` the way a shell would: commands containing a path separator are checked
 * directly (relative to `cwd`), bare names are searched in PATH (with PATHEXT on Windows).
 * Returns the resolved absolute path, or undefined when not found.
 */
export function findExecutable(
  command: string,
  options: ExecutableLookupOptions = {},
): string | undefined {
  const platform = options.platform ?? process.platform;
  const isWin = platform === 'win32';
  const p = isWin ? path.win32 : path.posix;
  const isExecutable = options.isExecutable ?? defaultIsExecutable;
  const pathEnv = options.pathEnv ?? process.env.PATH ?? '';
  const exts = isWin
    ? (options.pathExt ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .map((e) => e.trim())
        .filter((e) => e.length > 0)
    : [];

  let cmd = command.trim();
  if (cmd === '') {
    return undefined;
  }
  if (cmd === '~' || cmd.startsWith('~/') || (isWin && cmd.startsWith('~\\'))) {
    cmd = p.join(options.homeDir ?? os.homedir(), cmd.slice(1));
  }

  const candidates = (base: string): string[] => {
    if (!isWin) {
      return [base];
    }
    const hasExt = exts.some((e) => base.toLowerCase().endsWith(e.toLowerCase()));
    const withExt = exts.map((e) => base + e);
    return hasExt ? [base, ...withExt] : withExt;
  };

  const hasSeparator = isWin ? /[\\/]/.test(cmd) : cmd.includes('/');
  if (hasSeparator) {
    const full = p.isAbsolute(cmd) ? cmd : p.resolve(options.cwd ?? process.cwd(), cmd);
    return candidates(full).find(isExecutable);
  }

  const dirs = pathEnv
    .split(isWin ? ';' : ':')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter((d) => d.length > 0);
  for (const dir of dirs) {
    const found = candidates(p.join(dir, cmd)).find(isExecutable);
    if (found) {
      return found;
    }
  }
  return undefined;
}
