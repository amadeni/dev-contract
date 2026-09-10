import { BASE_SEED_PROFILE } from './config.js';
import { runConvexFunction } from './convexRun.js';
import { describeFailure, runCommand } from './exec.js';
import {
  DevContractError,
  type ResolvedDevContractConfig,
  type SeedOutput,
  type SeedProfile,
} from './types.js';

const log = (line: string) => process.stderr.write(`${line}\n`);

/** Whether `name` is a configured seed profile (own key only). */
export function hasSeedProfile(
  config: ResolvedDevContractConfig,
  name: string,
): boolean {
  const profiles = config.seed?.profiles;
  return profiles !== undefined && Object.hasOwn(profiles, name);
}

/**
 * Looks up a configured seed profile or throws the `[seed] unknown
 * profile <name>` error — own keys only, so inherited names such as
 * `toString` can never pass as an (empty) profile.
 */
export function resolveSeedProfile(
  config: ResolvedDevContractConfig,
  name: string,
): SeedProfile {
  const profiles = config.seed?.profiles;
  if (profiles && Object.hasOwn(profiles, name)) return profiles[name];
  const known = profiles ? Object.keys(profiles) : [];
  throw new DevContractError(
    'seed',
    `unknown profile ${name}` +
      (known.length
        ? ` (configured: ${known.join(', ')})`
        : ' (no `seed` block in the config)'),
  );
}

/**
 * Runs ONE seed profile (default `base`): its `command` first (shell,
 * project root), then its `function` (via `convex run`, with
 * `auth.identity` when configured). Both share the `timeouts.seedMs`
 * budget — each gets the full budget, a fixture is not an env call.
 *
 * A profile that is not configured (including: no seed block at all) is
 * a loud `[seed] unknown profile <name>` — asking for a seed that cannot
 * happen must never look like a successful no-op. Callers that treat
 * seeding as optional check `hasSeedProfile` first (`start` does that
 * for `base`).
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
  const profile = resolveSeedProfile(config, profileName);
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
