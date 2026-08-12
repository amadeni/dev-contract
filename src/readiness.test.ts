import { describe, expect, it, vi } from 'vitest';
import { waitFor } from './readiness.js';
import { DevContractError } from './types.js';

function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

describe('waitFor', () => {
  it('resolves with the first successful attempt', async () => {
    const clock = fakeClock();
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('not yet'))
      .mockRejectedValueOnce(new Error('still not'))
      .mockResolvedValue('ready');

    await expect(
      waitFor(attempt, {
        step: 'login-ready',
        description: 'verified dev login',
        timeoutMs: 60_000,
        intervalMs: 1_000,
        ...clock,
      }),
    ).resolves.toBe('ready');
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('times out with the step, attempt count, and LAST error in the diagnosis', async () => {
    const clock = fakeClock();
    const attempt = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new DevContractError('verify', 'no session cookie'));

    const promise = waitFor(attempt, {
      step: 'login-ready',
      description: 'verified dev login',
      timeoutMs: 10_000,
      intervalMs: 2_000,
      ...clock,
    });
    await expect(promise).rejects.toSatisfy(
      error =>
        error instanceof DevContractError &&
        error.step === 'login-ready' &&
        /not ready within 10000ms/.test(error.message) &&
        /6 attempts/.test(error.message) &&
        /no session cookie/.test(error.message),
    );
    // Deadline semantics: attempts at t=0,2,4,6,8,10 -> 6 attempts.
    expect(attempt).toHaveBeenCalledTimes(6);
  });

  it('aborts immediately when shouldAbort reports a reason', async () => {
    const clock = fakeClock();
    let attempts = 0;
    const promise = waitFor(
      async () => {
        attempts += 1;
        throw new Error('probe failed');
      },
      {
        step: 'app-ready',
        description: 'app answering',
        timeoutMs: 60_000,
        shouldAbort: () => (attempts >= 2 ? 'app dev server died' : undefined),
        ...clock,
      },
    );
    await expect(promise).rejects.toSatisfy(
      error =>
        error instanceof DevContractError &&
        error.step === 'app-ready' &&
        /aborted — app dev server died/.test(error.message) &&
        /probe failed/.test(error.message),
    );
    expect(attempts).toBe(2);
  });

  it('reports each failed attempt via onAttempt', async () => {
    const clock = fakeClock();
    const seen: number[] = [];
    await waitFor(
      (() => {
        let n = 0;
        return async () => {
          n += 1;
          if (n < 3) throw new Error(`fail ${n}`);
          return n;
        };
      })(),
      {
        step: 'convex-ready',
        description: 'x',
        timeoutMs: 60_000,
        onAttempt: ({ attempt }) => seen.push(attempt),
        ...clock,
      },
    );
    expect(seen).toEqual([1, 2]);
  });
});
