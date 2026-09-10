import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DevContractError,
  type DevContractConfig,
  type ResolvedDevContractConfig,
  type SeedProfile,
  type SeedProfileConfig,
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

/** Name of the profile `start` runs (the top-level `seed` block). */
export const BASE_SEED_PROFILE = 'base';

/** Profile names travel through `just dev-seed <profile>` — keep them shell-safe. */
const PROFILE_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * Validates one seed profile (the top-level block or a `profiles.<name>`
 * entry). An empty or malformed profile is a config error, not a silent
 * no-op — a project that declares seeding must get seeding (or a loud
 * failure), never a quiet skip.
 */
function parseSeedProfile(value: unknown, field: string): SeedProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      `\`${field}\` must be an object with \`command\` and/or \`function\`.`,
    );
  }
  const { command, function: fn, args } = value as SeedProfileConfig;
  if (
    command !== undefined &&
    (typeof command !== 'string' || !command.trim())
  ) {
    fail(
      `\`${field}.command\` must be a non-empty string (e.g. "pnpm run seed:dev").`,
    );
  }
  if (fn !== undefined && (typeof fn !== 'string' || !fn.trim())) {
    fail(
      `\`${field}.function\` must be a non-empty string ` +
        '(e.g. "testSupport/seed:ensureBaseData").',
    );
  }
  if (!command && !fn) {
    fail(`\`${field}\` needs at least one of \`command\` or \`function\`.`);
  }
  if (args !== undefined && !fn) {
    fail(
      `\`${field}.args\` is only valid together with \`${field}.function\`.`,
    );
  }
  if (args !== undefined && (typeof args !== 'object' || Array.isArray(args))) {
    fail(`\`${field}.args\` must be a JSON object.`);
  }
  return {
    ...(command ? { command: command.trim() } : {}),
    ...(fn ? { function: fn.trim() } : {}),
    args: args ?? {},
  };
}

/**
 * Resolves the optional seed block into named profiles. The top-level
 * `command` / `function` / `args` are the `base` profile (the pre-profile
 * config shape keeps working unchanged); `profiles.base` may take its
 * place, but both at once is a conflict and fails at load time.
 */
function parseSeed(
  value: DevContractConfig['seed'],
): ResolvedDevContractConfig['seed'] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      '`seed` must be an object with `command` and/or `function` (or `profiles`).',
    );
  }
  const { profiles, ...base } = value;
  const hasBase =
    base.command !== undefined ||
    base.function !== undefined ||
    base.args !== undefined;
  const resolved: Record<string, SeedProfile> = {};
  if (hasBase) {
    resolved[BASE_SEED_PROFILE] = parseSeedProfile(base, 'seed');
  }
  if (profiles !== undefined) {
    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
      fail(
        '`seed.profiles` must be an object mapping profile names to seed blocks.',
      );
    }
    for (const [name, profile] of Object.entries(profiles)) {
      if (!PROFILE_NAME.test(name)) {
        fail(
          `\`seed.profiles\` has an invalid profile name "${name}" ` +
            '(allowed: letters, digits, "_" and "-").',
        );
      }
      if (name === BASE_SEED_PROFILE && hasBase) {
        fail(
          '`seed.profiles.base` conflicts with the top-level `seed.command` / ' +
            '`seed.function` — the top-level block IS the base profile; declare it once.',
        );
      }
      resolved[name] = parseSeedProfile(profile, `seed.profiles.${name}`);
    }
  }
  if (Object.keys(resolved).length === 0) {
    fail(
      '`seed` needs at least one of `command` or `function` (or a non-empty `profiles` map).',
    );
  }
  return { profiles: resolved };
}

function parseTimeout(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`\`timeouts.${field}\` must be a positive number of milliseconds.`);
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
  const seed = parseSeed(config.seed);

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
    ...(seed ? { seed } : {}),
    timeouts: {
      convexReadyMs: parseTimeout(
        timeouts.convexReadyMs,
        'convexReadyMs',
        120_000,
      ),
      appReadyMs: parseTimeout(timeouts.appReadyMs, 'appReadyMs', 120_000),
      loginReadyMs: parseTimeout(timeouts.loginReadyMs, 'loginReadyMs', 90_000),
      seedMs: parseTimeout(timeouts.seedMs, 'seedMs', 300_000),
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
