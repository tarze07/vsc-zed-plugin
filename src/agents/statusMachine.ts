/**
 * Pure status state machine for agent sessions (#8). No `vscode` import (the `SessionStatus`
 * import below is type-only and erased at compile time), so it can be unit-tested in plain
 * mocha with an injected clock.
 *
 * Decisions (see docs/STATUS.md):
 * - Every shell execution in a session terminal is tracked, not only the first (agent) one.
 *   A new execution resets the state to `running` and clears attention / exit code.
 * - `output` after `waiting` returns to `running` and clears `needsAttention` (the agent is
 *   working again, so there is nothing left to attend to).
 * - `executionEnd` → `exited` with `needsAttention = true` (any exit code); `terminalClosed`
 *   → `exited` without attention (the user closed it deliberately). After `terminalClosed`
 *   every further event is ignored.
 * - `shellIntegrationUnavailable` → `running` in "untracked" mode: ticks never move it to
 *   `waiting` (no output can be observed); only a later real execution or closing the
 *   terminal changes it.
 */
import type { SessionStatus } from './types';

export interface StatusState {
  readonly status: SessionStatus;
  readonly needsAttention: boolean;
  readonly exitCode?: number;
  /** Timestamp (ms) of the last observed output or execution start. */
  readonly lastActivityAt?: number;
  /** True when shell integration is unavailable and only `running`/`exited` can be shown. */
  readonly untracked: boolean;
  /** True after the terminal was closed — terminal state, ignores further events. */
  readonly closed: boolean;
}

export type StatusEvent =
  | { readonly type: 'executionStart'; readonly now: number }
  | { readonly type: 'output'; readonly now: number }
  | { readonly type: 'tick'; readonly now: number }
  | { readonly type: 'executionEnd'; readonly exitCode?: number }
  | { readonly type: 'terminalClosed' }
  | { readonly type: 'focused' }
  | { readonly type: 'shellIntegrationUnavailable' };

export interface StatusMachineConfig {
  /** No output for at least this long while `running` → `waiting` + attention. */
  readonly waitingAfterMs: number;
}

/** Default for `zedLayout.status.waitingAfterSeconds`. */
export const DEFAULT_WAITING_AFTER_SECONDS = 5;

/** Converts the `waitingAfterSeconds` setting to milliseconds (invalid values → default, min 1 s). */
export function waitingAfterMsFromSetting(seconds: unknown): number {
  const value =
    typeof seconds === 'number' && Number.isFinite(seconds)
      ? seconds
      : DEFAULT_WAITING_AFTER_SECONDS;
  return Math.max(1, value) * 1000;
}

export function initialStatusState(
  status: SessionStatus = 'starting',
  needsAttention = false,
  exitCode?: number,
): StatusState {
  return { status, needsAttention, exitCode, untracked: false, closed: false };
}

/** Reduces one event. Returns the same object when nothing changed. */
export function reduceStatus(
  state: StatusState,
  event: StatusEvent,
  config: StatusMachineConfig,
): StatusState {
  if (state.closed) {
    return state;
  }
  switch (event.type) {
    case 'executionStart':
      return {
        status: 'running',
        needsAttention: false,
        exitCode: undefined,
        lastActivityAt: event.now,
        untracked: false,
        closed: false,
      };
    case 'output':
      if (state.status === 'exited') {
        return state;
      }
      if (state.status === 'running' || state.status === 'starting') {
        return { ...state, status: 'running', lastActivityAt: event.now };
      }
      // waiting → running: the agent is active again, attention no longer needed.
      return { ...state, status: 'running', needsAttention: false, lastActivityAt: event.now };
    case 'tick':
      if (
        state.status === 'running' &&
        !state.untracked &&
        state.lastActivityAt !== undefined &&
        event.now - state.lastActivityAt >= config.waitingAfterMs
      ) {
        return { ...state, status: 'waiting', needsAttention: true };
      }
      return state;
    case 'executionEnd':
      if (state.status === 'exited') {
        return state;
      }
      return {
        ...state,
        status: 'exited',
        needsAttention: true,
        exitCode: event.exitCode,
        untracked: false,
      };
    case 'terminalClosed':
      return { ...state, status: 'exited', needsAttention: false, untracked: false, closed: true };
    case 'focused':
      return state.needsAttention ? { ...state, needsAttention: false } : state;
    case 'shellIntegrationUnavailable':
      if (state.status !== 'starting') {
        return state;
      }
      return { ...state, status: 'running', untracked: true };
  }
}

/** Why a transition raised attention (for notifications), or undefined if it did not. */
export type AttentionReason = 'waiting' | 'exited';

export function attentionRaised(prev: StatusState, next: StatusState): AttentionReason | undefined {
  if (prev.needsAttention || !next.needsAttention) {
    return undefined;
  }
  if (next.status === 'waiting') {
    return 'waiting';
  }
  if (next.status === 'exited') {
    return 'exited';
  }
  return undefined;
}

/** True when the timer must keep ticking for this state (a `waiting` timeout is possible). */
export function needsTicks(state: StatusState): boolean {
  return !state.closed && !state.untracked && state.status === 'running';
}
