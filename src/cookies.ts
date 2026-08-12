/** One cookie from a `Set-Cookie` response header. */
export type ParsedCookie = { name: string; value: string };

/**
 * Extracts `name=value` pairs from `Set-Cookie` headers (attributes like
 * Path/HttpOnly are dropped — the contract replays cookies against the
 * same origin they were issued for). Values stay URL-encoded exactly as
 * the server sent them so the rebuilt `Cookie` header round-trips.
 */
export function parseSetCookies(setCookies: string[]): ParsedCookie[] {
  const cookies: ParsedCookie[] = [];
  for (const header of setCookies) {
    const pair = header.split(';', 1)[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) cookies.push({ name, value });
  }
  return cookies;
}

/** Builds a `Cookie` request header; later cookies win on name collision. */
export function buildCookieHeader(cookies: ParsedCookie[]): string {
  const byName = new Map<string, string>();
  for (const cookie of cookies) byName.set(cookie.name, cookie.value);
  return [...byName.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
];
const CONVEX_JWT_COOKIE_NAMES = [
  'better-auth.convex_jwt',
  '__Secure-better-auth.convex_jwt',
];

/**
 * The proof-of-login cookies Better Auth issues on a successful
 * `/magic-link/verify`: the session token (required — without it the login
 * did NOT happen) and the Convex JWT (present when the convex plugin is
 * wired; used for `ConvexHttpClient.setAuth`).
 */
export function findAuthCookies(cookies: ParsedCookie[]): {
  sessionToken?: string;
  convexJwt?: string;
} {
  const byName = new Map(cookies.map(cookie => [cookie.name, cookie.value]));
  const pick = (names: string[]) => {
    for (const name of names) {
      const value = byName.get(name);
      if (value) return value;
    }
    return undefined;
  };
  const sessionToken = pick(SESSION_COOKIE_NAMES);
  const convexJwt = pick(CONVEX_JWT_COOKIE_NAMES);
  return {
    ...(sessionToken ? { sessionToken } : {}),
    ...(convexJwt ? { convexJwt: decodeURIComponent(convexJwt) } : {}),
  };
}
