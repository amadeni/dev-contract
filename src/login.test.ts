import { describe, expect, it, vi } from 'vitest';
import { buildVerifyUrl, performLogin, type LoginTarget } from './login.js';
import { DevContractError } from './types.js';

const target: LoginTarget = {
  appUrl: 'http://localhost:3001',
  verifyPath: '/api/auth/magic-link/verify',
  sessionProbePath: '/api/auth/get-session',
  callbackPath: '/',
};

const mintToken = () =>
  Promise.resolve({ token: 'raw-token', email: 'dev@amadeni.local' });

function response(args: {
  status?: number;
  setCookies?: string[];
  location?: string;
  json?: unknown;
}): Response {
  const headers = new Headers();
  if (args.location) headers.set('location', args.location);
  const res = new Response(JSON.stringify(args.json ?? null), {
    status: args.status ?? 200,
    headers,
  });
  // Response headers are immutable for set-cookie via Headers in undici;
  // stub getSetCookie directly instead.
  vi.spyOn(res.headers, 'getSetCookie').mockReturnValue(args.setCookies ?? []);
  return res;
}

describe('buildVerifyUrl', () => {
  it('targets the app origin with token + callback params', () => {
    expect(buildVerifyUrl(target, 'a b')).toBe(
      'http://localhost:3001/api/auth/magic-link/verify?token=a+b&callbackURL=%2F&errorCallbackURL=%2F',
    );
  });
});

describe('performLogin', () => {
  it('returns the verified auth state on the happy path', async () => {
    const calls: { url: string; cookie?: string }[] = [];
    const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        cookie: (init?.headers as Record<string, string> | undefined)?.cookie,
      });
      if (url.includes('/magic-link/verify')) {
        return response({
          status: 302,
          location: '/',
          setCookies: [
            'better-auth.session_token=sess; Path=/; HttpOnly',
            'better-auth.convex_jwt=jwt%3D; Path=/',
          ],
        });
      }
      return response({ json: { user: { email: 'dev@amadeni.local' } } });
    }) as unknown as typeof fetch;

    const auth = await performLogin(target, { mintToken, fetchImpl });

    expect(calls[0].url).toContain('token=raw-token');
    expect(calls[1].url).toBe('http://localhost:3001/api/auth/get-session');
    // The probe replays EXACTLY the cookies the verify response issued.
    expect(calls[1].cookie).toBe(
      'better-auth.session_token=sess; better-auth.convex_jwt=jwt%3D',
    );
    expect(auth).toEqual({
      email: 'dev@amadeni.local',
      cookie: 'better-auth.session_token=sess; better-auth.convex_jwt=jwt%3D',
      cookies: {
        'better-auth.session_token': 'sess',
        'better-auth.convex_jwt': 'jwt%3D',
      },
      convexJwt: 'jwt=',
    });
  });

  it('fails the verify step when no session cookie is issued (login screen bounce)', async () => {
    const fetchImpl = vi.fn(async () =>
      response({ status: 302, location: '/login?error=INVALID_TOKEN' }),
    ) as unknown as typeof fetch;

    const promise = performLogin(target, { mintToken, fetchImpl });
    await expect(promise).rejects.toThrowError(
      /did not issue a session cookie/,
    );
    await expect(promise).rejects.toSatisfy(
      error =>
        error instanceof DevContractError &&
        error.step === 'verify' &&
        error.message.includes('/login?error=INVALID_TOKEN'),
    );
    // Never probes when the login already failed.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails the session-probe step on non-200', async () => {
    const fetchImpl = vi.fn(async (input: unknown) =>
      String(input).includes('verify')
        ? response({
            status: 302,
            setCookies: ['better-auth.session_token=sess'],
          })
        : response({ status: 401, json: null }),
    ) as unknown as typeof fetch;

    await expect(
      performLogin(target, { mintToken, fetchImpl }),
    ).rejects.toSatisfy(
      error =>
        error instanceof DevContractError && error.step === 'session-probe',
    );
  });

  it('treats a 200 with null body as NOT logged in (the flaky failure mode)', async () => {
    const fetchImpl = vi.fn(async (input: unknown) =>
      String(input).includes('verify')
        ? response({
            status: 302,
            setCookies: ['better-auth.session_token=sess'],
          })
        : response({ status: 200, json: null }),
    ) as unknown as typeof fetch;

    await expect(
      performLogin(target, { mintToken, fetchImpl }),
    ).rejects.toThrowError(/login is NOT verified/);
  });

  it('wraps network errors with the failing step', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(
      performLogin(target, { mintToken, fetchImpl }),
    ).rejects.toSatisfy(
      error =>
        error instanceof DevContractError &&
        error.step === 'verify' &&
        error.message.includes('ECONNREFUSED'),
    );
  });
});
