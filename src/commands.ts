import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { convexEnvSet, convexEnvSnapshot, mintDevToken } from './convexRun.js';
import { readProjectEnvValue } from './envFile.js';
import { assertProvisioningAllowed } from './guard.js';
import { buildVerifyUrl, performLogin, type LoginTarget } from './login.js';
import { buildAuthOutput, buildStartOutput } from './output.js';
import {
  pidIsRunning,
  startProcess,
  stopGroup,
  tailFile,
} from './processes.js';
import { waitFor } from './readiness.js';
import type {
  AuthOutput,
  AuthState,
  ResolvedDevContractConfig,
  StartOutput,
} from './types.js';

const log = (line: string) => process.stderr.write(`${line}\n`);

const DEV_AUTH_ENV_NAME = 'AMADENI_DEV_AUTH_ENABLED';

function loginTarget(config: ResolvedDevContractConfig): LoginTarget {
  return {
    appUrl: config.appUrl,
    verifyPath: config.auth.verifyPath,
    sessionProbePath: config.auth.sessionProbePath,
    callbackPath: config.auth.callbackPath,
  };
}

/**
 * HARD abort (no retry) when the deployment is not a dev deployment —
 * checked before anything is written. See `guard.ts`.
 */
function assertDevDeployment(config: ResolvedDevContractConfig): string {
  return assertProvisioningAllowed({
    deployment: readProjectEnvValue(config.root, 'CONVEX_DEPLOYMENT'),
    selfHostedUrl: readProjectEnvValue(config.root, 'CONVEX_SELF_HOSTED_URL'),
  });
}

/**
 * Reconciles the required Convex env state from a snapshot. Runs on EVERY
 * start — also when the servers were already up — so an environment
 * created before a setting existed gets repaired instead of reported
 * ready.
 */
async function applyProvisioning(
  config: ResolvedDevContractConfig,
  snapshot: Record<string, string>,
): Promise<void> {
  if (config.provision.devAuthFlag && snapshot[DEV_AUTH_ENV_NAME] !== 'true') {
    log(`Provisioning ${DEV_AUTH_ENV_NAME}=true on the dev deployment ...`);
    await convexEnvSet(config, DEV_AUTH_ENV_NAME, 'true');
  }
  if (config.provision.betterAuthSecret && !snapshot.BETTER_AUTH_SECRET) {
    log('Provisioning BETTER_AUTH_SECRET ...');
    await convexEnvSet(
      config,
      'BETTER_AUTH_SECRET',
      randomBytes(32).toString('base64url'),
    );
  }
  if (config.provision.siteUrl && snapshot.SITE_URL !== config.appUrl) {
    log(`Provisioning SITE_URL=${config.appUrl} ...`);
    await convexEnvSet(config, 'SITE_URL', config.appUrl);
  }
}

/**
 * The readiness gate: retries the full mint -> verify -> probe login until
 * it demonstrably works. Only a success here makes the contract "ready".
 */
async function verifiedLogin(
  config: ResolvedDevContractConfig,
  email: string,
  shouldAbort?: () => string | undefined,
): Promise<AuthState> {
  const target = loginTarget(config);
  const auth = await waitFor(
    () =>
      performLogin(target, {
        mintToken: () => mintDevToken(config, email),
      }),
    {
      step: 'login-ready',
      description: 'verified dev login (mint -> verify -> session probe)',
      timeoutMs: config.timeouts.loginReadyMs,
      intervalMs: 3_000,
      ...(shouldAbort ? { shouldAbort } : {}),
      onAttempt: ({ attempt, error }) =>
        log(
          `Login attempt ${attempt} failed: ${
            error instanceof Error
              ? error.message.split('\n')[0]
              : String(error)
          }`,
        ),
    },
  );
  // A second, UNUSED token for browser-based consumers (screenshots):
  // verify-tokens are single-use, the readiness gate consumed the first.
  const fresh = await mintDevToken(config, email);
  auth.loginUrl = buildVerifyUrl(target, fresh.token);
  return auth;
}

export async function runStart(
  config: ResolvedDevContractConfig,
  options?: { email?: string },
): Promise<StartOutput> {
  const email = options?.email ?? config.auth.email;
  const stateDir = config.stateDir;
  mkdirSync(stateDir, { recursive: true });
  const convexPidFile = path.join(stateDir, 'convex.pid');
  const appPidFile = path.join(stateDir, 'app.pid');

  // Convex pushes rename temp files into the workspace; a TMPDIR on a
  // different filesystem (container tmpfs vs bind mount) fails with EXDEV.
  const tmpDir = process.env.TMPDIR ?? path.join(stateDir, 'tmp');
  mkdirSync(tmpDir, { recursive: true });

  // Fresh checkouts have no .env.local: convex dev must pick the anonymous
  // local deployment deterministically instead of prompting.
  const extraEnv: Record<string, string> = { TMPDIR: tmpDir };
  const hadDeployment = readProjectEnvValue(config.root, 'CONVEX_DEPLOYMENT');
  if (!hadDeployment) {
    extraEnv.CONVEX_AGENT_MODE = 'anonymous';
  } else {
    // Known deployment: hard-abort BEFORE any process starts.
    assertDevDeployment(config);
  }

  const convexPid = await startProcess({
    name: 'convex',
    command: config.commands.convexDev,
    cwd: config.root,
    stateDir,
    env: extraEnv,
  });

  const convexDied = () =>
    pidIsRunning(convexPidFile)
      ? undefined
      : `convex dev died:\n${tailFile(path.join(stateDir, 'convex.log'))}`;

  await waitFor(
    async () => {
      const deployment = readProjectEnvValue(config.root, 'CONVEX_DEPLOYMENT');
      if (!deployment) {
        throw new Error('no CONVEX_DEPLOYMENT in .env.local yet');
      }
      return deployment;
    },
    {
      step: 'convex-ready',
      description: 'convex dev writing CONVEX_DEPLOYMENT',
      timeoutMs: 90_000,
      intervalMs: 1_000,
      shouldAbort: convexDied,
    },
  );

  // Guard again with the (possibly just-written) deployment — always a
  // hard abort, never retried.
  assertDevDeployment(config);

  const snapshot = await waitFor(() => convexEnvSnapshot(config), {
    step: 'convex-ready',
    description: 'Convex dev deployment answering (env snapshot)',
    timeoutMs: config.timeouts.convexReadyMs,
    shouldAbort: convexDied,
  });
  await applyProvisioning(config, snapshot);

  const appPid = await startProcess({
    name: 'app',
    command: config.commands.appDev,
    cwd: config.root,
    stateDir,
  });

  await waitFor(
    async () => {
      const response = await fetch(config.appUrl, { redirect: 'manual' });
      if (response.status >= 500) {
        throw new Error(`app answered ${response.status}`);
      }
    },
    {
      step: 'app-ready',
      description: `app answering at ${config.appUrl}`,
      timeoutMs: config.timeouts.appReadyMs,
      intervalMs: 1_000,
      shouldAbort: () =>
        pidIsRunning(appPidFile)
          ? undefined
          : `app dev server died:\n${tailFile(path.join(stateDir, 'app.log'))}`,
    },
  );

  const auth = await verifiedLogin(config, email, () => {
    const convexAbort = convexDied();
    if (convexAbort) return convexAbort;
    if (!pidIsRunning(appPidFile)) return 'app dev server died';
    return undefined;
  });

  const convexUrl =
    readProjectEnvValue(config.root, 'NEXT_PUBLIC_CONVEX_URL') ??
    readProjectEnvValue(config.root, 'CONVEX_URL');
  const convexSiteUrl =
    readProjectEnvValue(config.root, 'NEXT_PUBLIC_CONVEX_SITE_URL') ??
    (convexUrl?.endsWith('.convex.cloud')
      ? convexUrl.replace(/\.convex\.cloud$/, '.convex.site')
      : undefined);

  log(`Ready — login verified for ${auth.email}.`);
  return buildStartOutput({
    appUrl: config.appUrl,
    ...(convexUrl ? { convexUrl } : {}),
    ...(convexSiteUrl ? { convexSiteUrl } : {}),
    auth,
    pids: { convex: convexPid, app: appPid },
    stateDir,
  });
}

/**
 * `dev-contract auth`: a fresh verified session against an already-running
 * environment (same guard, same login gate, no process management — works
 * also when the servers were started by other means).
 */
export async function runAuth(
  config: ResolvedDevContractConfig,
  options?: { email?: string },
): Promise<AuthOutput> {
  const email = options?.email ?? config.auth.email;
  assertDevDeployment(config);
  const snapshot = await convexEnvSnapshot(config);
  await applyProvisioning(config, snapshot);
  const auth = await verifiedLogin(config, email);
  log(`Fresh verified session for ${auth.email}.`);
  return buildAuthOutput({ appUrl: config.appUrl, auth });
}

export async function runStop(
  config: ResolvedDevContractConfig,
): Promise<{ ok: true; stopped: string[] }> {
  const stopped: string[] = [];
  for (const name of ['app', 'convex']) {
    const pidFile = path.join(config.stateDir, `${name}.pid`);
    if (await stopGroup(pidFile)) stopped.push(name);
  }
  log(
    stopped.length
      ? `Stopped: ${stopped.join(', ')}.`
      : 'Nothing to stop (no pid files).',
  );
  return { ok: true, stopped };
}
