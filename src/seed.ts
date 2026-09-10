import { BASE_SEED_PROFILE } from './config.js';
import { runConvexFunction } from './convexRun.js';
import { describeFailure, runCommand } from './exec.js';
import {
  DevContractError,
  type ResolvedDevContractConfig,
  type SeedOutput,
} from './types.js';

const log = (line: string) => process.stderr.write(`${line}\n`);

/**
 * Runs ONE seed profile (default `base`): its `command` first (shell,
 * project root), then its `function` (via `convex run`, with
 * `auth.identity` when configured). Both share the `timeouts.seedMs`
 * budget — each gets the full budget, a fixture is not an env call.
 *
 * A profile that is not configured (including: no seed block at all) is
 * a loud `[seed] unknown profile <name>` — asking for a seed that cannot
 * happen must never look like a successful no-op. Callers that treat
 * seeding as optional check `config.seed?.profiles[name]` first (`start`
 * does that for `base`).
 *
 * IDEMPOTENCY IS THE PROJECT'S JOB: the contract reruns `base` on every
 * `start` and Mynd reruns `full` per review iteration, so every profile
 * must be insert-only / probe-then-insert. Any failure is a loud
 * `DevContractError('seed', ...)` — a start whose seed broke must never
 * report ready.
 *
 * Callers are responsible for the deployment guard (seeding writes data);
 * both `start` and `dev-contract seed` assert dev:/anonymous: first.
 */
export async function performSeed(
  config: ResolvedDevContractConfig,
  profileName: string = BASE_SEED_PROFILE,
): Promise<SeedOutput> {
  const profiles = config.seed?.profiles ?? {};
  const profile = profiles[profileName];
  if (!profile) {
    const known = Object.keys(profiles);
    throw new DevContractError(
      'seed',
      `unknown profile ${profileName}` +
        (known.length
          ? ` (configured: ${known.join(', ')})`
          : ' (no `seed` block in the config)'),
    );
  }
  const timeoutMs = config.timeouts.seedMs;
  const ran: SeedOutput['ran'] = [];

  if (profile.command) {
    log(`[seed] ${profileName}: running: ${profile.command}`);
    const result = await runCommand(['/bin/sh', '-c', profile.command], {
      cwd: config.root,
      timeoutMs,
    });
    if (result.exitCode !== 0) {
      throw new DevContractError(
        'seed',
        `profile ${profileName}: command "${profile.command}" failed ` +
          `(exit ${result.exitCode}):\n${describeFailure(result)}`,
      );
    }
    ran.push('command');
  }

  if (profile.function) {
    log(`[seed] ${profileName}: convex run ${profile.function}`);
    await runConvexFunction(config, {
      fn: profile.function,
      args: profile.args,
      step: 'seed',
      timeoutMs,
    });
    ran.push('function');
  }

  log(`[seed] ${profileName} done (${ran.join(' + ')}).`);
  return { ok: true, profile: profileName, ran };
}
