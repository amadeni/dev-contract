import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AuthOutput, AuthState, StartOutput } from './types.js';

/**
 * Builds the `dev-contract start` result. Field notes:
 *
 * - `baseUrl` duplicates `appUrl` on purpose: the previous shell contract
 *   (`just dev-start` -> `{"baseUrl": ...}`) is parsed by Mynd's executor
 *   with strict last-line semantics, so the new output stays a drop-in
 *   superset.
 * - `auth` is the whole point of the contract: a VERIFIED session
 *   (cookie replay against the session probe returned an authenticated
 *   body) — never emitted otherwise.
 */
export function buildStartOutput(args: {
  appUrl: string;
  convexUrl?: string;
  convexSiteUrl?: string;
  auth: AuthState;
  pids: { convex?: number; app?: number };
  stateDir: string;
  now?: () => number;
}): StartOutput {
  return {
    ok: true,
    baseUrl: args.appUrl,
    appUrl: args.appUrl,
    ...(args.convexUrl ? { convexUrl: args.convexUrl } : {}),
    ...(args.convexSiteUrl ? { convexSiteUrl: args.convexSiteUrl } : {}),
    auth: args.auth,
    readyAt: new Date(args.now?.() ?? Date.now()).toISOString(),
    pids: args.pids,
    stateDir: args.stateDir,
  };
}

/**
 * Builds the `dev-contract auth` result. `loginUrl` stays top-level for
 * the legacy `just dev-auth` -> `{"loginUrl": ...}` consumers.
 */
export function buildAuthOutput(args: {
  appUrl: string;
  auth: AuthState;
}): AuthOutput {
  return {
    ok: true,
    ...(args.auth.loginUrl ? { loginUrl: args.auth.loginUrl } : {}),
    baseUrl: args.appUrl,
    auth: args.auth,
  };
}

/**
 * The output contract: stderr carries all logging, stdout's LAST line is
 * the JSON object (single line). Optionally mirrored into a file for
 * consumers that prefer not to parse process output.
 */
export function emitContract(value: object, outFile?: string): void {
  const line = JSON.stringify(value);
  if (outFile) {
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, `${line}\n`);
  }
  process.stdout.write(`${line}\n`);
}
