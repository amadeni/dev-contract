import { spawn } from 'node:child_process';

export type ExecResult = { exitCode: number; stdout: string; stderr: string };

/** Compact failure diagnosis: the last lines of stderr + stdout. */
export function describeFailure(result: ExecResult): string {
  const tail = [result.stderr, result.stdout]
    .map(text => text.trim())
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .slice(-12)
    .join('\n');
  return tail || '<no output>';
}

/**
 * Runs an argv command (no shell) with captured output. Used for the
 * short-lived `convex env list/set` and `convex run` calls — long-running
 * dev servers go through `processes.ts` instead.
 */
export function runCommand(
  argv: string[],
  options: {
    cwd: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
  },
): Promise<ExecResult> {
  return new Promise(resolve => {
    const [command, ...args] = argv;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle({ exitCode: 124, stdout, stderr: `${stderr}\n[timeout]` });
    }, options.timeoutMs ?? 120_000);
    timer.unref?.();
    child.stdout.on('data', chunk => (stdout += String(chunk)));
    child.stderr.on('data', chunk => (stderr += String(chunk)));
    child.on('error', error =>
      settle({ exitCode: 127, stdout, stderr: `${stderr}\n${String(error)}` }),
    );
    child.on('close', code => settle({ exitCode: code ?? 1, stdout, stderr }));
  });
}
