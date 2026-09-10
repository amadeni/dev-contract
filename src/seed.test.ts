import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from './config.js';
import { runConvexFunction } from './convexRun.js';
import { runCommand } from './exec.js';
import { performSeed } from './seed.js';
import { DevContractError, type DevContractConfig } from './types.js';

vi.mock('./exec.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./exec.js')>()),
  runCommand: vi.fn(),
}));
vi.mock('./convexRun.js', () => ({ runConvexFunction: vi.fn() }));

const runCommandMock = vi.mocked(runCommand);
const runConvexFunctionMock = vi.mocked(runConvexFunction);

function configWithSeed(
  seed?: DevContractConfig['seed'],
  timeouts?: DevContractConfig['timeouts'],
) {
  return resolveConfig(
    {
      appUrl: 'http://localhost:3001',
      auth: { createTokenFunction: 'dev/auth:createDevToken' },
      ...(seed ? { seed } : {}),
      ...(timeouts ? { timeouts } : {}),
    },
    '/project',
  );
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  runCommandMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
  runConvexFunctionMock.mockResolvedValue('{}');
});

describe('performSeed', () => {
  it('rejects the base profile without a seed block as [seed] unknown profile', async () => {
    const failure = await failureOf(performSeed(configWithSeed()));
    expect(failure).toBeInstanceOf(DevContractError);
    expect((failure as DevContractError).message).toMatch(
      /^\[seed\] unknown profile base/,
    );
    expect(runCommandMock).not.toHaveBeenCalled();
    expect(runConvexFunctionMock).not.toHaveBeenCalled();
  });

  it('runs the command variant as a shell command in the project root with the seed budget', async () => {
    const config = configWithSeed({ command: 'pnpm run seed:dev' });
    await expect(performSeed(config)).resolves.toEqual({
      ok: true,
      profile: 'base',
      ran: ['command'],
    });
    expect(runCommandMock).toHaveBeenCalledWith(
      ['/bin/sh', '-c', 'pnpm run seed:dev'],
      { cwd: '/project', timeoutMs: 300_000 },
    );
    expect(runConvexFunctionMock).not.toHaveBeenCalled();
  });

  it('runs the function variant via convex run on the seed step with the seed budget', async () => {
    const config = configWithSeed({
      function: 'testSupport/seed:ensureBaseData',
      args: { profile: 'e2e' },
    });
    await expect(performSeed(config)).resolves.toEqual({
      ok: true,
      profile: 'base',
      ran: ['function'],
    });
    expect(runConvexFunctionMock).toHaveBeenCalledWith(config, {
      fn: 'testSupport/seed:ensureBaseData',
      args: { profile: 'e2e' },
      step: 'seed',
      timeoutMs: 300_000,
    });
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it('passes a configured timeouts.seedMs to both variants', async () => {
    const config = configWithSeed(
      { command: 'pnpm run seed:dev', function: 'testSupport/seed:ensure' },
      { seedMs: 42_000 },
    );
    await performSeed(config);
    expect(runCommandMock).toHaveBeenCalledWith(expect.any(Array), {
      cwd: '/project',
      timeoutMs: 42_000,
    });
    expect(runConvexFunctionMock).toHaveBeenCalledWith(
      config,
      expect.objectContaining({ timeoutMs: 42_000 }),
    );
  });

  it('runs command before function when both are configured', async () => {
    const config = configWithSeed({
      command: 'pnpm run seed:dev',
      function: 'testSupport/seed:ensureBaseData',
    });
    await expect(performSeed(config)).resolves.toEqual({
      ok: true,
      profile: 'base',
      ran: ['command', 'function'],
    });
    expect(runCommandMock.mock.invocationCallOrder[0]).toBeLessThan(
      runConvexFunctionMock.mock.invocationCallOrder[0],
    );
  });

  it('selects the requested profile and leaves the others alone', async () => {
    const config = configWithSeed({
      command: 'pnpm run seed:dev',
      profiles: {
        full: {
          command: 'pnpm run seed:full',
          function: 'testSupport/seed:ensureFixture',
          args: { scenario: 'review' },
        },
      },
    });
    await expect(performSeed(config, 'full')).resolves.toEqual({
      ok: true,
      profile: 'full',
      ran: ['command', 'function'],
    });
    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock).toHaveBeenCalledWith(
      ['/bin/sh', '-c', 'pnpm run seed:full'],
      { cwd: '/project', timeoutMs: 300_000 },
    );
    expect(runConvexFunctionMock).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        fn: 'testSupport/seed:ensureFixture',
        args: { scenario: 'review' },
      }),
    );
  });

  it('rejects an unknown profile with [seed] unknown profile <name> and runs nothing', async () => {
    const config = configWithSeed({
      command: 'pnpm run seed:dev',
      profiles: { full: { command: 'pnpm run seed:full' } },
    });
    const failure = await failureOf(performSeed(config, 'nightly'));
    expect(failure).toBeInstanceOf(DevContractError);
    expect((failure as DevContractError).step).toBe('seed');
    expect((failure as DevContractError).message).toBe(
      '[seed] unknown profile nightly (configured: base, full)',
    );
    expect(runCommandMock).not.toHaveBeenCalled();
    expect(runConvexFunctionMock).not.toHaveBeenCalled();
  });

  it.each(['toString', 'constructor', 'hasOwnProperty', ''])(
    'rejects the inherited / empty name %j instead of running an empty profile',
    async name => {
      const config = configWithSeed({ command: 'pnpm run seed:dev' });
      const failure = await failureOf(performSeed(config, name));
      expect(failure).toBeInstanceOf(DevContractError);
      expect((failure as DevContractError).message).toBe(
        `[seed] unknown profile ${name} (configured: base)`,
      );
      expect(runCommandMock).not.toHaveBeenCalled();
    },
  );

  it('fails loudly with a [seed] diagnosis when the command exits non-zero', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'unique violation on users.email',
    });
    const config = configWithSeed({
      command: 'pnpm run seed:dev',
      function: 'testSupport/seed:ensureBaseData',
    });
    const failure = await failureOf(performSeed(config));
    expect(failure).toBeInstanceOf(DevContractError);
    expect((failure as DevContractError).step).toBe('seed');
    expect((failure as DevContractError).message).toMatch(/^\[seed\] /);
    expect((failure as DevContractError).message).toContain(
      'unique violation on users.email',
    );
    // The function variant must not run on top of a broken command.
    expect(runConvexFunctionMock).not.toHaveBeenCalled();
  });

  it('propagates a failing seed function', async () => {
    runConvexFunctionMock.mockRejectedValue(
      new DevContractError('seed', 'testSupport/seed:ensureBaseData failed'),
    );
    const config = configWithSeed({
      function: 'testSupport/seed:ensureBaseData',
    });
    await expect(performSeed(config)).rejects.toMatchObject({
      name: 'DevContractError',
      step: 'seed',
    });
  });
});
