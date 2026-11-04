import { execFile } from 'child_process';

/** Output of a successful `git` invocation. */
export interface GitResult {
  stdout: string;
  stderr: string;
}

export interface GitRunOptions {
  /** Working directory for the command. */
  cwd: string;
  /** Timeout in milliseconds (default: the runner's default). */
  timeout?: number;
}

/** Runs `git` with an argument array (never through a shell). Injectable for tests. */
export type GitRunner = (args: readonly string[], options: GitRunOptions) => Promise<GitResult>;

/** Error thrown when `git` fails, cannot be started or times out. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly stderr: string,
    readonly stdout: string,
    /** Process exit code, if git ran and exited with an error. */
    readonly exitCode?: number,
    /** Node error code, e.g. `ENOENT` when git is not on PATH. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'GitError';
  }

  /** Best human-readable explanation: git's stderr, else the message. */
  get detail(): string {
    return this.stderr.trim() || this.message;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/** Creates a runner backed by `child_process.execFile`. */
export function createGitRunner(gitPath = 'git', defaultTimeout = DEFAULT_TIMEOUT_MS): GitRunner {
  return (args, options) =>
    new Promise<GitResult>((resolve, reject) => {
      execFile(
        gitPath,
        [...args],
        {
          cwd: options.cwd,
          timeout: options.timeout ?? defaultTimeout,
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
          encoding: 'utf8',
          // Never block on credential / editor prompts.
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ stdout, stderr });
            return;
          }
          const err = error as NodeJS.ErrnoException & { code?: string | number; killed?: boolean };
          const exitCode = typeof err.code === 'number' ? err.code : undefined;
          const code = typeof err.code === 'string' ? err.code : undefined;
          let message: string;
          if (code === 'ENOENT') {
            message = `git executable not found (${gitPath}). Is Git installed and on PATH?`;
          } else if (err.killed) {
            message = `git ${args.join(' ')} timed out`;
          } else {
            message = `git ${args.join(' ')} failed${exitCode !== undefined ? ` (exit ${exitCode})` : ''}: ${(stderr || err.message).trim()}`;
          }
          reject(new GitError(message, args, stderr ?? '', stdout ?? '', exitCode, code));
        },
      );
    });
}

/** Message suitable for the user: git's stderr when available. */
export function gitErrorDetail(error: unknown): string {
  if (error instanceof GitError) {
    return error.detail;
  }
  return error instanceof Error ? error.message : String(error);
}
