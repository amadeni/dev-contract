import { spawn } from 'node:child_process';
import {
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DevContractError } from './types.js';

const log = (line: string) => process.stderr.write(`${line}\n`);

function readPid(pidFile: string): number | undefined {
  try {
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Liveness via the process GROUP (the dev servers spawn children — convex
 * dev's local backend, next's workers), so kill(-pid, 0) sees the whole
 * tree the contract started.
 */
export function pidIsRunning(pidFile: string): number | undefined {
  const pid = readPid(pidFile);
  if (!pid) return undefined;
  try {
    process.kill(-pid, 0);
    return pid;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Starts a long-running dev server as a detached process-group leader with
 * its output in `<stateDir>/<name>.log` and its pid in
 * `<stateDir>/<name>.pid`. Idempotent: an already-running group is reused.
 * A process that dies within the first 2 seconds fails loudly with the log
 * tail — silent zombies are how "ready" lies start.
 */
export async function startProcess(args: {
  name: string;
  command: string;
  cwd: string;
  stateDir: string;
  env?: Record<string, string | undefined>;
}): Promise<number> {
  mkdirSync(args.stateDir, { recursive: true });
  const pidFile = path.join(args.stateDir, `${args.name}.pid`);
  const logFile = path.join(args.stateDir, `${args.name}.log`);

  const running = pidIsRunning(pidFile);
  if (running) {
    log(`${args.name} already running (pgid ${running}).`);
    return running;
  }

  log(`Starting ${args.name}: ${args.command}`);
  const out = openSync(logFile, 'a');
  const child = spawn('/bin/sh', ['-c', args.command], {
    cwd: args.cwd,
    env: { ...process.env, ...args.env },
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  if (!child.pid) {
    throw new DevContractError(
      args.name === 'convex' ? 'convex-start' : 'app-start',
      `failed to spawn ${args.name}.`,
    );
  }
  writeFileSync(pidFile, `${child.pid}\n`);

  await sleep(2_000);
  if (!pidIsRunning(pidFile)) {
    rmSync(pidFile, { force: true });
    throw new DevContractError(
      args.name === 'convex' ? 'convex-start' : 'app-start',
      `${args.name} died immediately:\n${tailFile(logFile)}`,
    );
  }
  return child.pid;
}

export function tailFile(file: string, lines = 40): string {
  try {
    return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n');
  } catch {
    return '<no log>';
  }
}

/** TERM -> wait up to 10s -> KILL, on the whole process group; idempotent. */
export async function stopGroup(pidFile: string): Promise<boolean> {
  const pid = readPid(pidFile);
  if (!pid) return false;
  const alive = () => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (alive()) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Group vanished between the check and the kill.
    }
    for (let i = 0; i < 10 && alive(); i += 1) {
      await sleep(1_000);
    }
    if (alive()) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
  rmSync(pidFile, { force: true });
  return true;
}
