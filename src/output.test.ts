import { describe, expect, it } from 'vitest';
import { buildAuthOutput, buildStartOutput } from './output.js';
import type { AuthState } from './types.js';

const auth: AuthState = {
  email: 'dev@amadeni.local',
  cookie: 'better-auth.session_token=sess',
  cookies: { 'better-auth.session_token': 'sess' },
  convexJwt: 'jwt',
  loginUrl: 'http://localhost:3001/api/auth/magic-link/verify?token=fresh',
};

describe('buildStartOutput', () => {
  it('produces the full contract shape', () => {
    const output = buildStartOutput({
      appUrl: 'http://localhost:3001',
      convexUrl: 'https://x.convex.cloud',
      convexSiteUrl: 'https://x.convex.site',
      auth,
      pids: { convex: 11, app: 22 },
      stateDir: '/p/.dev-contract',
      now: () => Date.UTC(2026, 0, 2, 3, 4, 5),
    });
    expect(output).toEqual({
      ok: true,
      baseUrl: 'http://localhost:3001',
      appUrl: 'http://localhost:3001',
      convexUrl: 'https://x.convex.cloud',
      convexSiteUrl: 'https://x.convex.site',
      auth,
      readyAt: '2026-01-02T03:04:05.000Z',
      pids: { convex: 11, app: 22 },
      stateDir: '/p/.dev-contract',
    });
  });

  it('stays compatible with the legacy dev-start contract (last-line JSON with baseUrl)', () => {
    const output = buildStartOutput({
      appUrl: 'http://localhost:3001',
      auth,
      pids: {},
      stateDir: '/p/.dev-contract',
    });
    // Mynd's executor parses the LAST stdout line as a JSON object and
    // requires an http(s) `baseUrl` — mirror of parseDevStartOutput.
    const line = JSON.stringify(output);
    expect(line.includes('\n')).toBe(false);
    const parsed = JSON.parse(line) as { baseUrl: string };
    expect(new URL(parsed.baseUrl).protocol).toBe('http:');
  });
});

describe('buildAuthOutput', () => {
  it('lifts loginUrl to the top level (legacy dev-auth contract)', () => {
    const output = buildAuthOutput({ appUrl: 'http://localhost:3001', auth });
    expect(output.loginUrl).toBe(auth.loginUrl);
    expect(output.baseUrl).toBe('http://localhost:3001');
    expect(output.auth).toBe(auth);
  });

  it('omits loginUrl when the auth state has none', () => {
    const withoutLoginUrl: AuthState = { ...auth };
    delete withoutLoginUrl.loginUrl;
    const output = buildAuthOutput({
      appUrl: 'http://localhost:3001',
      auth: withoutLoginUrl,
    });
    expect('loginUrl' in output).toBe(false);
  });
});
