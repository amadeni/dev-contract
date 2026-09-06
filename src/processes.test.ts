import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { logSize, readLogSince } from './processes.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'dev-contract-log-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('log marks', () => {
  it('reads only what was appended after a byte mark, multibyte-safe', () => {
    const file = path.join(dir, 'convex.log');
    writeFileSync(file, '✔ 11:00:00 Convex functions ready! (old)\n');
    const mark = logSize(file);
    expect(readLogSince(file, mark)).toBe('');
    writeFileSync(file, '- Preparing Convex functions...\n', { flag: 'a' });
    expect(readLogSince(file, mark)).toBe('- Preparing Convex functions...\n');
    writeFileSync(file, '✔ 12:00:00 Convex functions ready! (1.2s)\n', {
      flag: 'a',
    });
    expect(readLogSince(file, mark)).toMatch(/^- Preparing/);
    expect(readLogSince(file, mark)).toMatch(
      /Convex functions ready! \(1\.2s\)/,
    );
  });

  it('treats a missing log as empty and mark 0', () => {
    const missing = path.join(dir, 'nope.log');
    expect(logSize(missing)).toBe(0);
    expect(readLogSince(missing, 0)).toBe('');
  });
});
