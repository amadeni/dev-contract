import { runCommand, type ExecResult } from './exec.js';
import { DevContractError, type ResolvedDevContractConfig } from './types.js';

/**
 * Extracts the JSON object from `convex run` stdout. The CLI pretty-prints
 * the result (possibly after banner noise), so the parse takes the
 * substring from the last `{` opening a parseable object — strict enough
 * to reject non-JSON output, tolerant of leading log lines.
 */
export function parseConvexRunJson(output: string): Record<string, unknown> {
  const trimmed = output.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `convex run did not return JSON: ${trimmed.slice(-200) || '<empty>'}`,
    );
  }
  const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('convex run returned JSON that is not an object.');
  }
  return parsed as Record<string, unknown>;
}

function describeFailure(result: ExecResult): string {
  const tail = [result.stderr, result.stdout]
    .map(text => text.trim())
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .slice(-12)
    .join('\n');
  return tail || '<no output>';
}

/** Runs the project's dev token function via `convex run`. */
export async function mintDevToken(
  config: ResolvedDevContractConfig,
  email: string,
): Promise<{ token: string; email: string }> {
  const argv = [
    config.packageManager,
    'exec',
    'convex',
    'run',
    '--typecheck',
    'disable',
    '--codegen',
    'disable',
  ];
  if (config.auth.identity) {
    argv.push('--identity', JSON.stringify(config.auth.identity));
  }
  argv.push(
    config.auth.createTokenFunction,
    JSON.stringify({ ...config.auth.tokenArgs, email }),
  );

  const result = await runCommand(argv, { cwd: config.root });
  if (result.exitCode !== 0) {
    throw new DevContractError(
      'mint-token',
      `${config.auth.createTokenFunction} failed (exit ${result.exitCode}):\n` +
        describeFailure(result),
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseConvexRunJson(result.stdout);
  } catch (error) {
    throw new DevContractError('mint-token', String(error));
  }
  if (typeof parsed.token !== 'string' || !parsed.token) {
    throw new DevContractError(
      'mint-token',
      `${config.auth.createTokenFunction} did not return a "token" string.`,
    );
  }
  return {
    token: parsed.token,
    email: typeof parsed.email === 'string' ? parsed.email : email,
  };
}

/** `convex env list` as a name -> value map (throws on read failure). */
export async function convexEnvSnapshot(
  config: ResolvedDevContractConfig,
): Promise<Record<string, string>> {
  const result = await runCommand(
    [config.packageManager, 'exec', 'convex', 'env', 'list'],
    { cwd: config.root },
  );
  if (result.exitCode !== 0) {
    // A masked read error must never look like "variable missing" — that
    // would rotate secrets and invalidate sessions.
    throw new DevContractError(
      'provision',
      `convex env list failed (exit ${result.exitCode}):\n${describeFailure(result)}`,
    );
  }
  const values: Record<string, string> = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq > 0) values[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return values;
}

export async function convexEnvSet(
  config: ResolvedDevContractConfig,
  name: string,
  value: string,
): Promise<void> {
  const result = await runCommand(
    [config.packageManager, 'exec', 'convex', 'env', 'set', '--', name, value],
    { cwd: config.root },
  );
  if (result.exitCode !== 0) {
    throw new DevContractError(
      'provision',
      `convex env set ${name} failed (exit ${result.exitCode}):\n` +
        describeFailure(result),
    );
  }
}
