import { describe, expect, it } from 'vitest';
import { parseEnvFile } from './envFile.js';

describe('parseEnvFile', () => {
  it('parses KEY=value lines', () => {
    expect(
      parseEnvFile(
        [
          'CONVEX_DEPLOYMENT=dev:calm-otter-123 # team: amadeni',
          'NEXT_PUBLIC_CONVEX_URL=https://calm-otter-123.convex.cloud',
          '',
          '# comment',
          'QUOTED="hello world"',
          "SINGLE='x=y'",
          'export EXPORTED=1',
        ].join('\n'),
      ),
    ).toEqual({
      CONVEX_DEPLOYMENT: 'dev:calm-otter-123',
      NEXT_PUBLIC_CONVEX_URL: 'https://calm-otter-123.convex.cloud',
      QUOTED: 'hello world',
      SINGLE: 'x=y',
      EXPORTED: '1',
    });
  });

  it('ignores malformed lines', () => {
    expect(parseEnvFile('=x\nNOEQUALS\n1BAD=x')).toEqual({});
  });
});
