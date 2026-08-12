import { describe, expect, it } from 'vitest';
import {
  buildCookieHeader,
  findAuthCookies,
  parseSetCookies,
} from './cookies.js';

describe('parseSetCookies', () => {
  it('extracts name=value pairs and drops attributes', () => {
    expect(
      parseSetCookies([
        'better-auth.session_token=abc.def; Path=/; HttpOnly; SameSite=Lax',
        'better-auth.convex_jwt=eyJ%3D; Max-Age=3600',
      ]),
    ).toEqual([
      { name: 'better-auth.session_token', value: 'abc.def' },
      { name: 'better-auth.convex_jwt', value: 'eyJ%3D' },
    ]);
  });

  it('keeps values URL-encoded so the Cookie header round-trips', () => {
    const [cookie] = parseSetCookies(['a=x%2Fy%3D; Path=/']);
    expect(cookie.value).toBe('x%2Fy%3D');
  });

  it('ignores malformed headers', () => {
    expect(parseSetCookies(['', 'novalue', '=orphan'])).toEqual([]);
  });
});

describe('buildCookieHeader', () => {
  it('joins cookies; later values win on collisions', () => {
    expect(
      buildCookieHeader([
        { name: 'a', value: '1' },
        { name: 'b', value: '2' },
        { name: 'a', value: '3' },
      ]),
    ).toBe('a=3; b=2');
  });
});

describe('findAuthCookies', () => {
  it('finds the plain session token and decodes the convex JWT', () => {
    const result = findAuthCookies([
      { name: 'better-auth.session_token', value: 'tok' },
      { name: 'better-auth.convex_jwt', value: 'ey%2FJ%3D' },
    ]);
    expect(result).toEqual({ sessionToken: 'tok', convexJwt: 'ey/J=' });
  });

  it('supports the __Secure- prefixed variants (https apps)', () => {
    const result = findAuthCookies([
      { name: '__Secure-better-auth.session_token', value: 'tok' },
    ]);
    expect(result.sessionToken).toBe('tok');
  });

  it('reports nothing when the login did not happen', () => {
    expect(findAuthCookies([{ name: 'other', value: 'x' }])).toEqual({});
  });
});
