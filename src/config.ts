import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DevContractError,
  type DevContractConfig,
  type ResolvedDevContractConfig,
} from './types.js';

export const CONFIG_FILE_CANDIDATES = [
  'devcontract.config.json',
  'devcontract.config.mjs',
  'devcontract.config.js',
];

const DEFAULT_EMAIL = 'dev@amadeni.local';
const DEFAULT_VERIFY_PATH = '/api/auth/magic-link/verify';
const DEFAULT_SESSION_PROBE_PATH = '/api/auth/get-session';

function fail(message: string): never {
  throw new DevContractError('config', message);
}

function parseAppUrl(value: unknown): { appUrl: string; appPort: number } {
  if (typeof value !== 'string' || !value.trim()) {
    fail('`appUrl` is required (e.g. "http://localhost:3001").');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(`\`appUrl\` is not a valid URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(`\`appUrl\` must be http(s), got: ${value}`);
  }
  const appPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return { appUrl: value.replace(/\/+$/, ''), appPort };
}

function ensurePath(value: string, field: string): string {
  if (!value.startsWith('/')) {
    fail(`\`${field}\` must start with "/", got: ${value}`);
  }
  return value;
}

/**
 * Pure validation + defaulting. Throws `DevContractError('config', ...)`
 * with a field-level message — a broken config must fail loudly before any
 * process is started.
 */
export function resolveConfig(
  raw: unknown,
  root: string,
): ResolvedDevContractConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('Config must be a JSON object.');
  }
  const config = raw as DevContractConfig;
  const { appUrl, appPort } = parseAppUrl(config.appUrl);

  if (!config.auth || typeof config.auth !== 'object') {
    fail('`auth` is required (dev-auth fixture wiring).');
  }
  const {
    createTokenFunction,
    identity,
    email,
    tokenArgs,
    verifyPath,
    sessionProbePath,
    callbackPath,
  } = config.auth;
  if (typeof createTokenFunction !== 'string' || !createTokenFunction.trim()) {
    fail(
      '`auth.createTokenFunction` is required (e.g. "dev/auth:createDevToken").',
    );
  }
  if (identity !== undefined) {
    if (
      typeof identity.issuer !== 'string' ||
      !identity.issuer ||
      typeof identity.subject !== 'string' ||
      !identity.subject
    ) {
      fail('`auth.identity` needs non-empty `issuer` and `subject`.');
    }
  }

  const packageManager = config.packageManager ?? 'pnpm';
  const timeouts = config.timeouts ?? {};

  return {
    root,
    appUrl,
    appPort,
    packageManager,
    commands: {
      convexDev:
        config.commands?.convexDev ?? `${packageManager} exec convex dev`,
      appDev:
        config.commands?.appDev ??
        `${packageManager} exec next dev -p ${appPort}`,
    },
    auth: {
      createTokenFunction: createTokenFunction.trim(),
      ...(identity ? { identity } : {}),
      email: email ?? DEFAULT_EMAIL,
      tokenArgs: tokenArgs ?? {},
      verifyPath: ensurePath(
        verifyPath ?? DEFAULT_VERIFY_PATH,
        'auth.verifyPath',
      ),
      sessionProbePath: ensurePath(
        sessionProbePath ?? DEFAULT_SESSION_PROBE_PATH,
        'auth.sessionProbePath',
      ),
      callbackPath: ensurePath(callbackPath ?? '/', 'auth.callbackPath'),
    },
    provision: {
      betterAuthSecret: config.provision?.betterAuthSecret ?? true,
      devAuthFlag: config.provision?.devAuthFlag ?? true,
      siteUrl: config.provision?.siteUrl ?? true,
    },
    timeouts: {
      convexReadyMs: timeouts.convexReadyMs ?? 120_000,
      appReadyMs: timeouts.appReadyMs ?? 120_000,
      loginReadyMs: timeouts.loginReadyMs ?? 90_000,
    },
    stateDir: path.resolve(root, config.stateDir ?? '.dev-contract'),
  };
}

/**
 * Loads `devcontract.config.json` / `.mjs` / `.js` from the project root
 * (or an explicit `--config` path) and resolves it.
 */
export async function loadConfig(
  root: string,
  explicitPath?: string,
): Promise<ResolvedDevContractConfig> {
  const candidates = explicitPath
    ? [path.resolve(root, explicitPath)]
    : CONFIG_FILE_CANDIDATES.map(name => path.resolve(root, name));
  const file = candidates.find(candidate => existsSync(candidate));
  if (!file) {
    fail(
      `No dev-contract config found. Looked for: ${candidates
        .map(candidate => path.relative(root, candidate))
        .join(', ')}`,
    );
  }

  let raw: unknown;
  if (file.endsWith('.json')) {
    try {
      raw = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      fail(`Failed to parse ${file}: ${String(error)}`);
    }
  } else {
    const mod = (await import(pathToFileURL(file).href)) as {
      default?: unknown;
    };
    raw = mod.default;
    if (raw === undefined) {
      fail(`${file} must export the config as its default export.`);
    }
  }
  return resolveConfig(raw, root);
}
