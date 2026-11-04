import * as assert from 'assert';

import {
  attentionRaised,
  initialStatusState,
  needsTicks,
  reduceStatus,
  waitingAfterMsFromSetting,
  type StatusEvent,
  type StatusState,
} from '../agents/statusMachine';

const CONFIG = { waitingAfterMs: 5000 };

function run(events: StatusEvent[], start: StatusState = initialStatusState()): StatusState {
  return events.reduce((state, event) => reduceStatus(state, event, CONFIG), start);
}

suite('Status machine', () => {
  test('starts as starting without attention', () => {
    const s = initialStatusState();
    assert.strictEqual(s.status, 'starting');
    assert.strictEqual(s.needsAttention, false);
    assert.strictEqual(s.exitCode, undefined);
    assert.strictEqual(needsTicks(s), false);
  });

  test('executionStart → running', () => {
    const s = run([{ type: 'executionStart', now: 1000 }]);
    assert.strictEqual(s.status, 'running');
    assert.strictEqual(s.needsAttention, false);
    assert.strictEqual(needsTicks(s), true);
  });

  test('no output for waitingAfterMs → waiting + attention (fake clock)', () => {
    let s = run([{ type: 'executionStart', now: 0 }]);
    s = reduceStatus(s, { type: 'tick', now: 4999 }, CONFIG);
    assert.strictEqual(s.status, 'running');
    s = reduceStatus(s, { type: 'tick', now: 5000 }, CONFIG);
    assert.strictEqual(s.status, 'waiting');
    assert.strictEqual(s.needsAttention, true);
    assert.strictEqual(needsTicks(s), false);
  });

  test('output resets the waiting timeout', () => {
    const s = run([
      { type: 'executionStart', now: 0 },
      { type: 'output', now: 3000 },
      { type: 'tick', now: 7000 },
    ]);
    assert.strictEqual(s.status, 'running');
    const later = reduceStatus(s, { type: 'tick', now: 8000 }, CONFIG);
    assert.strictEqual(later.status, 'waiting');
  });

  test('respects a custom timeout', () => {
    const start = run([{ type: 'executionStart', now: 0 }]);
    const s = reduceStatus(start, { type: 'tick', now: 1000 }, { waitingAfterMs: 1000 });
    assert.strictEqual(s.status, 'waiting');
  });

  test('output after waiting → running and clears attention', () => {
    const s = run([
      { type: 'executionStart', now: 0 },
      { type: 'tick', now: 6000 },
      { type: 'output', now: 7000 },
    ]);
    assert.strictEqual(s.status, 'running');
    assert.strictEqual(s.needsAttention, false);
  });

  test('focus clears attention but keeps waiting', () => {
    const s = run([
      { type: 'executionStart', now: 0 },
      { type: 'tick', now: 6000 },
      { type: 'focused' },
    ]);
    assert.strictEqual(s.status, 'waiting');
    assert.strictEqual(s.needsAttention, false);
  });

  test('focus without attention returns the same object', () => {
    const s = run([{ type: 'executionStart', now: 0 }]);
    assert.strictEqual(reduceStatus(s, { type: 'focused' }, CONFIG), s);
  });

  test('ticks do not change a non-running state', () => {
    const starting = initialStatusState();
    assert.strictEqual(reduceStatus(starting, { type: 'tick', now: 1e9 }, CONFIG), starting);
    const waiting = run([
      { type: 'executionStart', now: 0 },
      { type: 'tick', now: 6000 },
    ]);
    assert.strictEqual(reduceStatus(waiting, { type: 'tick', now: 1e9 }, CONFIG), waiting);
  });

  test('executionEnd → exited with attention and exit code', () => {
    const s = run([
      { type: 'executionStart', now: 0 },
      { type: 'executionEnd', exitCode: 2 },
    ]);
    assert.strictEqual(s.status, 'exited');
    assert.strictEqual(s.needsAttention, true);
    assert.strictEqual(s.exitCode, 2);
    assert.strictEqual(needsTicks(s), false);
  });

  test('executionEnd with exit 0 and with unknown exit code', () => {
    assert.strictEqual(
      run([
        { type: 'executionStart', now: 0 },
        { type: 'executionEnd', exitCode: 0 },
      ]).exitCode,
      0,
    );
    const unknown = run([{ type: 'executionStart', now: 0 }, { type: 'executionEnd' }]);
    assert.strictEqual(unknown.status, 'exited');
    assert.strictEqual(unknown.exitCode, undefined);
    assert.strictEqual(unknown.needsAttention, true);
  });

  test('executionEnd while waiting → exited', () => {
    const s = run([
      { type: 'executionStart', now: 0 },
      { type: 'tick', now: 6000 },
      { type: 'focused' },
      { type: 'executionEnd', exitCode: 1 },
    ]);
    assert.strictEqual(s.status, 'exited');
    assert.strictEqual(s.needsAttention, true);
    assert.strictEqual(s.exitCode, 1);
  });

  test('output after exit is ignored; a duplicate end is ignored', () => {
    const exited = run([
      { type: 'executionStart', now: 0 },
      { type: 'executionEnd', exitCode: 0 },
    ]);
    assert.strictEqual(reduceStatus(exited, { type: 'output', now: 1 }, CONFIG), exited);
    assert.strictEqual(reduceStatus(exited, { type: 'executionEnd', exitCode: 3 }, CONFIG), exited);
  });

  test('a new execution in the same terminal → running, clears exit code and attention', () => {
    const s = run([
      { type: 'executionStart', now: 0 },
      { type: 'executionEnd', exitCode: 1 },
      { type: 'executionStart', now: 100 },
    ]);
    assert.strictEqual(s.status, 'running');
    assert.strictEqual(s.needsAttention, false);
    assert.strictEqual(s.exitCode, undefined);
  });

  test('terminalClosed → exited without attention, then ignores everything', () => {
    const s = run([
      { type: 'executionStart', now: 0 },
      { type: 'tick', now: 6000 },
      { type: 'terminalClosed' },
    ]);
    assert.strictEqual(s.status, 'exited');
    assert.strictEqual(s.needsAttention, false);
    assert.strictEqual(s.closed, true);
    for (const e of [
      { type: 'executionStart', now: 1 },
      { type: 'output', now: 1 },
      { type: 'executionEnd', exitCode: 1 },
      { type: 'shellIntegrationUnavailable' },
    ] as StatusEvent[]) {
      assert.strictEqual(reduceStatus(s, e, CONFIG), s);
    }
  });

  test('shell integration unavailable → running, never waiting', () => {
    let s = run([{ type: 'shellIntegrationUnavailable' }]);
    assert.strictEqual(s.status, 'running');
    assert.strictEqual(s.untracked, true);
    assert.strictEqual(needsTicks(s), false);
    s = reduceStatus(s, { type: 'tick', now: 1e9 }, CONFIG);
    assert.strictEqual(s.status, 'running');
    s = reduceStatus(s, { type: 'terminalClosed' }, CONFIG);
    assert.strictEqual(s.status, 'exited');
    assert.strictEqual(s.needsAttention, false);
  });

  test('fallback is ignored once an execution was seen; late execution leaves fallback', () => {
    const running = run([{ type: 'executionStart', now: 0 }]);
    assert.strictEqual(
      reduceStatus(running, { type: 'shellIntegrationUnavailable' }, CONFIG),
      running,
    );
    const late = run([
      { type: 'shellIntegrationUnavailable' },
      { type: 'executionStart', now: 10 },
      { type: 'tick', now: 6000 },
    ]);
    assert.strictEqual(late.untracked, false);
    assert.strictEqual(late.status, 'waiting');
  });

  test('initial state can mirror an existing session', () => {
    const s = initialStatusState('exited', true, 1);
    assert.deepStrictEqual(
      [s.status, s.needsAttention, s.exitCode, s.closed],
      ['exited', true, 1, false],
    );
  });

  test('attentionRaised reports only false → true edges', () => {
    const running = run([{ type: 'executionStart', now: 0 }]);
    const waiting = reduceStatus(running, { type: 'tick', now: 6000 }, CONFIG);
    assert.strictEqual(attentionRaised(running, waiting), 'waiting');
    assert.strictEqual(attentionRaised(waiting, waiting), undefined);
    const exited = reduceStatus(waiting, { type: 'executionEnd', exitCode: 1 }, CONFIG);
    assert.strictEqual(attentionRaised(waiting, exited), undefined);
    const exitedFromRunning = reduceStatus(running, { type: 'executionEnd' }, CONFIG);
    assert.strictEqual(attentionRaised(running, exitedFromRunning), 'exited');
    const closed = reduceStatus(running, { type: 'terminalClosed' }, CONFIG);
    assert.strictEqual(attentionRaised(running, closed), undefined);
  });

  test('waitingAfterMsFromSetting validates the setting', () => {
    assert.strictEqual(waitingAfterMsFromSetting(5), 5000);
    assert.strictEqual(waitingAfterMsFromSetting(2.5), 2500);
    assert.strictEqual(waitingAfterMsFromSetting(0), 1000);
    assert.strictEqual(waitingAfterMsFromSetting(undefined), 5000);
    assert.strictEqual(waitingAfterMsFromSetting('x'), 5000);
    assert.strictEqual(waitingAfterMsFromSetting(Number.NaN), 5000);
  });
});
