import { DevContractError, type ContractStep } from './types.js';

export type WaitOptions = {
  /** Which contract step this wait belongs to (error attribution). */
  step: ContractStep;
  /** Human description for the timeout diagnosis. */
  description: string;
  timeoutMs: number;
  intervalMs?: number;
  /** Aborts the wait early (e.g. "the process I am waiting for died"). */
  shouldAbort?: () => string | undefined;
  /** Test seams. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (info: { attempt: number; error: unknown }) => void;
};

const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * The readiness loop: retries `attempt` until it resolves, the deadline
 * passes, or `shouldAbort` reports a reason. On timeout the LAST error is
 * part of the diagnosis — "which step failed and why", never a bare
 * "timed out".
 */
export async function waitFor<T>(
  attempt: () => Promise<T>,
  options: WaitOptions,
): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = now() + options.timeoutMs;
  let lastError: unknown;
  let attemptCount = 0;

  for (;;) {
    const abortReason = options.shouldAbort?.();
    if (abortReason) {
      throw new DevContractError(
        options.step,
        `${options.description}: aborted — ${abortReason}` +
          (lastError ? `\nlast error: ${describeError(lastError)}` : ''),
      );
    }
    attemptCount += 1;
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      options.onAttempt?.({ attempt: attemptCount, error });
    }
    if (now() >= deadline) {
      throw new DevContractError(
        options.step,
        `${options.description}: not ready within ${options.timeoutMs}ms ` +
          `(${attemptCount} attempts).\nlast error: ${describeError(lastError)}`,
      );
    }
    await sleep(intervalMs);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? '<none>');
}
