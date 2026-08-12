import {
  buildCookieHeader,
  findAuthCookies,
  parseSetCookies,
} from './cookies.js';
import { DevContractError, type AuthState } from './types.js';

export type LoginTarget = {
  appUrl: string;
  verifyPath: string;
  sessionProbePath: string;
  callbackPath: string;
};

export type LoginDeps = {
  /** Mints a fresh single-use dev token (see `convexRun.mintDevToken`). */
  mintToken: () => Promise<{ token: string; email: string }>;
  /** Test seam; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

export function buildVerifyUrl(target: LoginTarget, token: string): string {
  const params = new URLSearchParams();
  params.set('token', token);
  params.set('callbackURL', target.callbackPath);
  params.set('errorCallbackURL', target.callbackPath);
  return `${target.appUrl}${target.verifyPath}?${params.toString()}`;
}

/**
 * The core guarantee of the contract lives here: this function only
 * resolves after a login DEMONSTRABLY worked —
 *
 * 1. mint a fresh single-use token (Convex-side dev-auth fixture),
 * 2. consume it at the magic link verify endpoint and require the Better
 *    Auth session cookie in the response (no cookie = no login),
 * 3. replay the cookies against the session probe and require an
 *    authenticated, non-null session body (a 200 with `null` is exactly
 *    the flaky "login screen instead of app" failure mode — it counts as
 *    NOT logged in).
 *
 * Every failure names its step (`mint-token` / `verify` /
 * `session-probe`) so retries and diagnoses stay precise.
 */
export async function performLogin(
  target: LoginTarget,
  deps: LoginDeps,
): Promise<AuthState> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { token, email } = await deps.mintToken();

  // Step: verify — consume the token, collect the session cookies.
  const verifyUrl = buildVerifyUrl(target, token);
  let verifyResponse: Response;
  try {
    verifyResponse = await fetchImpl(verifyUrl, { redirect: 'manual' });
  } catch (error) {
    throw new DevContractError(
      'verify',
      `verify request to ${target.verifyPath} failed: ${String(error)}`,
      { cause: error },
    );
  }
  const setCookies = verifyResponse.headers.getSetCookie();
  const cookies = parseSetCookies(setCookies);
  const { sessionToken, convexJwt } = findAuthCookies(cookies);
  if (!sessionToken) {
    const location = verifyResponse.headers.get('location');
    throw new DevContractError(
      'verify',
      `magic link verify did not issue a session cookie for ${email} ` +
        `(status ${verifyResponse.status}, location ${location ?? 'none'}, ` +
        `set-cookie names: ${
          cookies.map(cookie => cookie.name).join(', ') || '<none>'
        }).`,
    );
  }

  // Step: session-probe — prove the cookies authenticate a request.
  const cookieHeader = buildCookieHeader(cookies);
  const probeUrl = `${target.appUrl}${target.sessionProbePath}`;
  let probeResponse: Response;
  let body: unknown;
  try {
    probeResponse = await fetchImpl(probeUrl, {
      headers: { cookie: cookieHeader },
    });
    body = await probeResponse.json();
  } catch (error) {
    throw new DevContractError(
      'session-probe',
      `session probe ${target.sessionProbePath} failed: ${String(error)}`,
      { cause: error },
    );
  }
  if (!probeResponse.ok) {
    throw new DevContractError(
      'session-probe',
      `session probe returned ${probeResponse.status} for ${email}.`,
    );
  }
  // Better Auth's get-session answers 200 with `null` for anonymous
  // requests — the status alone proves nothing.
  if (!body || typeof body !== 'object') {
    throw new DevContractError(
      'session-probe',
      `session probe returned 200 but no session for ${email} ` +
        `(body: ${JSON.stringify(body)?.slice(0, 200)}). The login is NOT ` +
        'verified.',
    );
  }

  return {
    email,
    cookie: cookieHeader,
    cookies: Object.fromEntries(
      cookies.map(cookie => [cookie.name, cookie.value]),
    ),
    ...(convexJwt ? { convexJwt } : {}),
  };
}
