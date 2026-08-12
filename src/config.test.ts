import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.js';
import { DevContractError } from './types.js';

const minimal = {
  appUrl: 'http://localhost:3001',
  auth: { createTokenFunction: 'dev/auth:createDevToken' },
};

describe('resolveConfig', () => {
  it('applies all defaults for a minimal config', () => {
    const config = resolveConfig(minimal, '/project');
    expect(config).toMatchObject({
      root: '/project',
      appUrl: 'http://localhost:3001',
      appPort: 3001,
      packageManager: 'pnpm',
      commands: {
        convexDev: 'pnpm exec convex dev',
        appDev: 'pnpm exec next dev -p 3001',
      },
      auth: {
        createTokenFunction: 'dev/auth:createDevToken',
        email: 'dev@amadeni.local',
        verifyPath: '/api/auth/magic-link/verify',
        sessionProbePath: '/api/auth/get-session',
        callbackPath: '/',
      },
      provision: { betterAuthSecret: true, devAuthFlag: true, siteUrl: true },
      timeouts: {
        convexReadyMs: 120_000,
        appReadyMs: 120_000,
        loginReadyMs: 90_000,
      },
      stateDir: '/project/.dev-contract',
    });
  });

  it('derives default ports from the protocol', () => {
    expect(
      resolveConfig({ ...minimal, appUrl: 'https://example.test' }, '/p')
        .appPort,
    ).toBe(443);
  });

  it('strips trailing slashes from appUrl', () => {
    expect(
      resolveConfig({ ...minimal, appUrl: 'http://localhost:3001/' }, '/p')
        .appUrl,
    ).toBe('http://localhost:3001');
  });

  it('honors overrides (package manager flows into default commands)', () => {
    const config = resolveConfig(
      {
        ...minimal,
        packageManager: 'npm',
        commands: { convexDev: 'npm run convex' },
        auth: {
          ...minimal.auth,
          identity: { issuer: 'hub-dev-auth', subject: 'dev-auth-cli' },
          email: 'robot@dev.local',
          tokenArgs: { role: 'admin' },
        },
        provision: { devAuthFlag: false },
        timeouts: { loginReadyMs: 5_000 },
        stateDir: 'runtime/.state',
      },
      '/project',
    );
    expect(config.commands.convexDev).toBe('npm run convex');
    expect(config.commands.appDev).toBe('npm exec next dev -p 3001');
    expect(config.auth.identity).toEqual({
      issuer: 'hub-dev-auth',
      subject: 'dev-auth-cli',
    });
    expect(config.auth.tokenArgs).toEqual({ role: 'admin' });
    expect(config.provision).toEqual({
      betterAuthSecret: true,
      devAuthFlag: false,
      siteUrl: true,
    });
    expect(config.timeouts.loginReadyMs).toBe(5_000);
    expect(config.stateDir).toBe('/project/runtime/.state');
  });

  it('leaves `seed` absent when not configured', () => {
    expect(resolveConfig(minimal, '/p').seed).toBeUndefined();
  });

  it('resolves the seed command variant', () => {
    const config = resolveConfig(
      { ...minimal, seed: { command: 'pnpm run seed:dev ' } },
      '/p',
    );
    expect(config.seed).toEqual({ command: 'pnpm run seed:dev', args: {} });
  });

  it('resolves the seed function variant (args default to {})', () => {
    const config = resolveConfig(
      { ...minimal, seed: { function: 'testSupport/seed:ensureBaseData' } },
      '/p',
    );
    expect(config.seed).toEqual({
      function: 'testSupport/seed:ensureBaseData',
      args: {},
    });
  });

  it('resolves seed with both variants and explicit args', () => {
    const config = resolveConfig(
      {
        ...minimal,
        seed: {
          command: 'pnpm run seed:dev',
          function: 'testSupport/seed:ensureBaseData',
          args: { profile: 'e2e' },
        },
      },
      '/p',
    );
    expect(config.seed).toEqual({
      command: 'pnpm run seed:dev',
      function: 'testSupport/seed:ensureBaseData',
      args: { profile: 'e2e' },
    });
  });

  it.each([
    [null, /object/],
    [{}, /appUrl/],
    [{ ...minimal, seed: 'pnpm run seed:dev' }, /`seed` must be an object/],
    [{ ...minimal, seed: {} }, /at least one of `command` or `function`/],
    [{ ...minimal, seed: { command: '  ' } }, /seed\.command/],
    [{ ...minimal, seed: { function: 42 } }, /seed\.function/],
    [
      { ...minimal, seed: { command: 'x', args: { a: 1 } } },
      /`seed\.args` is only valid together with `seed\.function`/,
    ],
    [
      { ...minimal, seed: { function: 'f:g', args: [1] } },
      /`seed\.args` must be a JSON object/,
    ],
    [{ appUrl: 'not-a-url', auth: minimal.auth }, /not a valid URL/],
    [{ appUrl: 'ftp://x', auth: minimal.auth }, /http\(s\)/],
    [{ appUrl: minimal.appUrl }, /`auth` is required/],
    [
      { appUrl: minimal.appUrl, auth: {} },
      /auth\.createTokenFunction` is required/,
    ],
    [
      {
        ...minimal,
        auth: { ...minimal.auth, identity: { issuer: '', subject: 'x' } },
      },
      /issuer/,
    ],
    [
      { ...minimal, auth: { ...minimal.auth, verifyPath: 'api/verify' } },
      /must start with "\/"/,
    ],
  ])('rejects invalid config %j', (raw, message) => {
    expect(() => resolveConfig(raw, '/p')).toThrowError(message);
    try {
      resolveConfig(raw, '/p');
    } catch (error) {
      expect(error).toBeInstanceOf(DevContractError);
      expect((error as DevContractError).step).toBe('config');
    }
  });
});
