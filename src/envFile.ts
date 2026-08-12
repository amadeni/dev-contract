import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Minimal `.env` parser: `KEY=value` lines, `#` comments, optional single
 * or double quotes around the value. No multi-line values, no expansion —
 * enough for `CONVEX_DEPLOYMENT` / `NEXT_PUBLIC_CONVEX_URL` style files
 * without pulling in a dependency.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      const comment = value.search(/\s#/);
      if (comment !== -1) value = value.slice(0, comment).trim();
    }
    values[match[1]] = value;
  }
  return values;
}

/**
 * Resolves an env var the way the Convex CLI does for local development:
 * process env first, then `.env.local`, then `.env` in the project root.
 */
export function readProjectEnvValue(
  root: string,
  name: string,
  processEnv: Record<string, string | undefined> = process.env,
): string | undefined {
  if (processEnv[name]) return processEnv[name];
  for (const file of ['.env.local', '.env']) {
    try {
      const parsed = parseEnvFile(readFileSync(path.join(root, file), 'utf8'));
      if (parsed[name] !== undefined && parsed[name] !== '') {
        return parsed[name];
      }
    } catch {
      // File missing — fine.
    }
  }
  return undefined;
}
