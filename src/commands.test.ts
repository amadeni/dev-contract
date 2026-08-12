import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSeed, runStart } from './commands.js';
import { resolveConfig } from './config.js';
import { convexEnvSnapshot, mintDevToken } from './convexRun.js';
import { readProjectEnvValue } from './envFile.js';
import { performLogin } from './login.js';
import { startProcess } from './processes.js';
import { performSeed } from './seed.js';
import { DevContractError, type DevContractConfig } from './types.js';

vi.mock('./processes.js', () => ({
  pidIsRunning: vi.fn(() => 1),
  startProcess: vi.fn(),
  stopGroup: vi.fn(),
  tailFile: vi.fn(() => '<no log>'),
}));
vi.mock('./convexRun.js', () => ({
  convexEnvSet: vi.fn(),
  convexEnvSnapshot: vi.fn(),
  mintDevToken: vi.fn(),
}));
vi.mock('./envFile.js', () => ({ readProjectEnvValue: vi.fn() }));
vi.mock('./login.js', () => ({
  buildVerifyUrl: vi.fn(() => 'http://localhost:3999/verify?token=t'),
  performLogin: vi.fn(),
}));
vi.mock('./seed.js', () => ({ performSeed: vi.fn() }));

const startProcessMock = vi.mocked(startProcess);
const convexEnvSnapshotMock = vi.mocked(convexEnvSnapshot);
const mintDevTokenMock = vi.mocked(mintDevToken);
const readProjectEnvValueMock = vi.mocked(readProjectEnvValue);
const performLoginMock = vi.mocked(performLogin);
const performSeedMock = vi.mocked(performSeed);

const APP_URL = 'http://localhost:3999';
const root = mkdtempSync(path.join(os.tmpdir(), 'dev-contract-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function makeConfig(seed?: DevContractConfig['seed']) {
  return resolveConfig(
    {
      appUrl: APP_URL,
      auth: { createTokenFunction: 'dev/auth:createDevToken' },
      ...(seed ? { seed } : {}),
    },
    root,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  readProjectEnvValueMock.mockImplementation((_root, name) =>
    name === 'CONVEX_DEPLOYMENT' ? 'dev:test-app' : undefined,
  );
  startProcessMock.mockImplementation(async ({ name }) =>
    name === 'convex' ? 11 : 22,
  );
  // A fully provisioned snapshot: applyProvisioning has nothing to write.
  convexEnvSnapshotMock.mockResolvedValue({
    AMADENI_DEV_AUTH_ENABLED: 'true',
    BETTER_AUTH_SECRET: 'secret',
    SITE_URL: APP_URL,
  });
  mintDevTokenMock.mockResolvedValue({
    token: 't',
    email: 'dev@amadeni.local',
  });
  performLoginMock.mockResolvedValue({
    email: 'dev@amadeni.local',
    cookie: 'better-auth.session_token=s',
    cookies: { 'better-auth.session_token': 's' },
  });
  performSeedMock.mockResolvedValue({ ok: true, ran: ['function'] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ status: 200 })),
  );
});

describe('runStart state machine', () => {
  it('seeds AFTER backend readiness and BEFORE app start + login gate', async () => {
    const seedConfig = makeConfig({ function: 'testSupport/seed:ensure' });
    const output = await runStart(seedConfig);
    expect(output.ok).toBe(true);

    expect(performSeedMock).toHaveBeenCalledTimes(1);
    const seedOrder = performSeedMock.mock.invocationCallOrder[0];
    // Backend readiness (env snapshot answered) happened before the seed.
    expect(convexEnvSnapshotMock.mock.invocationCallOrder[0]).toBeLessThan(
      seedOrder,
    );
    // The app dev server starts only after the seed succeeded ...
    expect(startProcessMock).toHaveBeenCalledTimes(2);
    expect(startProcessMock.mock.calls[0][0].name).toBe('convex');
    expect(startProcessMock.mock.calls[1][0].name).toBe('app');
    expect(seedOrder).toBeLessThan(
      startProcessMock.mock.invocationCallOrder[1],
    );
    // ... and the login gate runs strictly after the seed.
    expect(seedOrder).toBeLessThan(
      performLoginMock.mock.invocationCallOrder[0],
    );
  });

  it('a failing seed aborts the start — no app, no login, no ready', async () => {
    performSeedMock.mockRejectedValue(
      new DevContractError('seed', 'base data seed broke'),
    );
    const failure = await runStart(makeConfig({ command: 'pnpm seed' })).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(DevContractError);
    expect((failure as DevContractError).step).toBe('seed');
    // Only convex was started; the app and the login gate never ran.
    expect(startProcessMock).toHaveBeenCalledTimes(1);
    expect(startProcessMock.mock.calls[0][0].name).toBe('convex');
    expect(performLoginMock).not.toHaveBeenCalled();
  });
});

describe('runSeed (manual re-seeding)', () => {
  it('refuses without a configured seed block', async () => {
    await expect(runSeed(makeConfig())).rejects.toMatchObject({
      name: 'DevContractError',
      step: 'seed',
    });
    expect(performSeedMock).not.toHaveBeenCalled();
  });

  it('guards against non-dev deployments before seeding', async () => {
    readProjectEnvValueMock.mockImplementation((_root, name) =>
      name === 'CONVEX_DEPLOYMENT' ? 'prod:live-app' : undefined,
    );
    await expect(
      runSeed(makeConfig({ command: 'pnpm run seed:dev' })),
    ).rejects.toMatchObject({ name: 'DevContractError', step: 'guard' });
    expect(performSeedMock).not.toHaveBeenCalled();
  });

  it('seeds a running dev environment', async () => {
    await expect(
      runSeed(makeConfig({ function: 'testSupport/seed:ensure' })),
    ).resolves.toEqual({ ok: true, ran: ['function'] });
    expect(performSeedMock).toHaveBeenCalledTimes(1);
  });
});
