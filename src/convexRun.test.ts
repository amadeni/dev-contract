import { describe, expect, it } from 'vitest';
import { parseConvexRunJson } from './convexRun.js';

describe('parseConvexRunJson', () => {
  it('parses a plain JSON object', () => {
    expect(parseConvexRunJson('{"token":"abc","email":"x@y.z"}')).toEqual({
      token: 'abc',
      email: 'x@y.z',
    });
  });

  it('parses the pretty-printed multi-line output of convex run', () => {
    const output = `{
  "email": "dev@amadeni.local",
  "token": "uuid-uuid"
}`;
    expect(parseConvexRunJson(output)).toMatchObject({ token: 'uuid-uuid' });
  });

  it('skips leading banner noise before the JSON object', () => {
    const output = [
      'Preparing Convex functions...',
      '✔ Deployment ready',
      '{ "token": "abc" }',
    ].join('\n');
    expect(parseConvexRunJson(output)).toEqual({ token: 'abc' });
  });

  it('throws on empty or non-JSON output', () => {
    expect(() => parseConvexRunJson('')).toThrowError(/did not return JSON/);
    expect(() => parseConvexRunJson('null')).toThrowError(
      /did not return JSON/,
    );
    expect(() => parseConvexRunJson('token=abc')).toThrowError(
      /did not return JSON/,
    );
  });

  it('throws on JSON that is not an object', () => {
    expect(() => parseConvexRunJson('[1, 2, 3]')).toThrowError(
      /did not return JSON/,
    );
    expect(() => parseConvexRunJson('"a string"')).toThrowError(
      /did not return JSON/,
    );
  });
});
