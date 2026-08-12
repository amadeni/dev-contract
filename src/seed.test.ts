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

function configWithSeed(seed?: DevContractConfig['seed']) {
  return resolveConfig(
    {
      appUrl: 'http://localhost:3001',
      auth: { createTokenFunction: 'dev/auth:createDevToken' },
      ...(seed ? { seed } : {}),
    },
    '/project',
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  runCommandMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
  runConvexFunctionMock.mockResolvedValue('{}');
});

describe('performSeed', () => {
  it('is a no-op without a seed block', async () => {
    await expect(performSeed(configWithSeed())).resolves.toEqual({
      ok: true,
      ran: [],
    });
    expect(runCommandMock).not.toHaveBeenCalled();
    expect(runConvexFunctionMock).not.toHaveBeenCalled();
  });

  it('runs the command variant as a shell command in the project root', async () => {
    const config = configWithSeed({ command: 'pnpm run seed:dev' });
    await expect(performSeed(config)).resolves.toEqual({
      ok: true,
      ran: ['command'],
    });
    expect(runCommandMock).toHaveBeenCalledWith(
      ['/bin/sh', '-c', 'pnpm run seed:dev'],
      { cwd: '/project' },
    );
    expect(runConvexFunctionMock).not.toHaveBeenCalled();
  });

  it('runs the function variant via convex run on the seed step', async () => {
    const config = configWithSeed({
      function: 'testSupport/seed:ensureBaseData',
      args: { profile: 'e2e' },
    });
    await expect(performSeed(config)).resolves.toEqual({
      ok: true,
      ran: ['function'],
    });
    expect(runConvexFunctionMock).toHaveBeenCalledWith(config, {
      fn: 'testSupport/seed:ensureBaseData',
      args: { profile: 'e2e' },
      step: 'seed',
    });
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it('runs command before function when both are configured', async () => {
    const config = configWithSeed({
      command: 'pnpm run seed:dev',
      function: 'testSupport/seed:ensureBaseData',
    });
    await expect(performSeed(config)).resolves.toEqual({
      ok: true,
      ran: ['command', 'function'],
    });
    expect(runCommandMock.mock.invocationCallOrder[0]).toBeLessThan(
      runConvexFunctionMock.mock.invocationCallOrder[0],
    );
  });

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
    const failure = await performSeed(config).then(
      () => undefined,
      (error: unknown) => error,
    );
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
