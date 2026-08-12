import { runConvexFunction } from './convexRun.js';
import { describeFailure, runCommand } from './exec.js';
import {
  DevContractError,
  type ResolvedDevContractConfig,
  type SeedOutput,
} from './types.js';

const log = (line: string) => process.stderr.write(`${line}\n`);

/**
 * Runs the configured seed block: `seed.command` first (shell, project
 * root), then `seed.function` (via `convex run`, with `auth.identity` when
 * configured). No seed block means a silent no-op — seeding is optional.
 *
 * IDEMPOTENCY IS THE PROJECT'S JOB: the contract reruns the seed on every
 * `start`, so it must be insert-only / probe-then-insert. Any failure is a
 * loud `DevContractError('seed', ...)` — a start whose seed broke must
 * never report ready.
 *
 * Callers are responsible for the deployment guard (seeding writes data);
 * both `start` and `dev-contract seed` assert dev:/anonymous: first.
 */
export async function performSeed(
  config: ResolvedDevContractConfig,
): Promise<SeedOutput> {
  const seed = config.seed;
  const ran: SeedOutput['ran'] = [];
  if (!seed) return { ok: true, ran };

  if (seed.command) {
    log(`[seed] running: ${seed.command}`);
    const result = await runCommand(['/bin/sh', '-c', seed.command], {
      cwd: config.root,
    });
    if (result.exitCode !== 0) {
      throw new DevContractError(
        'seed',
        `seed command "${seed.command}" failed (exit ${result.exitCode}):\n` +
          describeFailure(result),
      );
    }
    ran.push('command');
  }

  if (seed.function) {
    log(`[seed] convex run ${seed.function}`);
    await runConvexFunction(config, {
      fn: seed.function,
      args: seed.args,
      step: 'seed',
    });
    ran.push('function');
  }

  log(`[seed] done (${ran.join(' + ')}).`);
  return { ok: true, ran };
}
