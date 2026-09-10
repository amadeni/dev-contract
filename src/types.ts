/**
 * One seed profile as written in the config: a shell command and/or a
 * Convex function (with optional JSON args). At least one of the two is
 * required; with both set the command runs first.
 */
export type SeedProfileConfig = {
  /** Shell command run in the project root, e.g. `pnpm run seed:dev`. */
  command?: string;
  /**
   * Convex function run via `convex run` (with `auth.identity` when
   * configured), e.g. `testSupport/seed:ensureBaseData`.
   */
  function?: string;
  /** JSON args for `function`; only valid together with it. */
  args?: Record<string, unknown>;
};

/** A validated seed profile (`args` defaulted to `{}`). */
export type SeedProfile = {
  command?: string;
  function?: string;
  args: Record<string, unknown>;
};

/** Raw config as read from `devcontract.config.json` / `.mjs`. */
export type DevContractConfig = {
  /** Public URL of the frontend dev server, e.g. `http://localhost:3001`. */
  appUrl: string;
  /** Package manager used for `exec convex ...`; default `pnpm`. */
  packageManager?: string;
  commands?: {
    /** Default: `<pm> exec convex dev`. */
    convexDev?: string;
    /** Default: `<pm> exec next dev -p <appUrl port>`. */
    appDev?: string;
  };
  auth: {
    /**
     * Convex function that mints the dev login token, e.g.
     * `dev/auth:createDevToken`. Must return `{ token: string }` (a raw
     * magic link token whose HASHED verification row exists — see
     * `createDevAuth` in @amadeni/better-auth-kit).
     */
    createTokenFunction: string;
    /** Synthetic identity for `convex run --identity` (CLI-gated actions). */
    identity?: { issuer: string; subject: string };
    /** Test user email; default `dev@amadeni.local`. */
    email?: string;
    /** Extra args merged into the token function call (after `email`). */
    tokenArgs?: Record<string, unknown>;
    /** Default: `/api/auth/magic-link/verify`. */
    verifyPath?: string;
    /**
     * Authenticated readiness probe; default `/api/auth/get-session`.
     * Must return a non-null JSON body only for a valid session.
     */
    sessionProbePath?: string;
    /** `callbackURL` passed to the verify endpoint; default `/`. */
    callbackPath?: string;
  };
  provision?: {
    /** Generate `BETTER_AUTH_SECRET` when missing; default true. */
    betterAuthSecret?: boolean;
    /** Set `AMADENI_DEV_AUTH_ENABLED=true`; default true. */
    devAuthFlag?: boolean;
    /** Keep `SITE_URL` equal to `appUrl`; default true. */
    siteUrl?: boolean;
  };
  /**
   * Optional base-data seeding. The top-level `command` / `function` /
   * `args` ARE the `base` profile — what `start` runs AFTER the backend
   * is ready and provisioned but BEFORE the login gate (the test user /
   * base data must exist before the login is verified). Further profiles
   * (fleet convention: `full` = the complete test fixture, run by Mynd via
   * `just dev-seed full`) live in `profiles` and only ever run on request
   * (`dev-contract seed --profile <name>`). Every profile MUST be
   * idempotent (insert-only or probe-then-insert) — the contract reruns
   * `base` on every start.
   */
  seed?: SeedProfileConfig & {
    /**
     * Named seed profiles. `profiles.base` may replace the top-level
     * block, but declaring both is a config error (one source of truth).
     */
    profiles?: Record<string, SeedProfileConfig>;
  };
  timeouts?: {
    /** Waiting for the Convex dev deployment to answer; default 120s. */
    convexReadyMs?: number;
    /** Waiting for the app dev server to answer HTTP; default 120s. */
    appReadyMs?: number;
    /** Waiting for a VERIFIED login (the readiness gate); default 90s. */
    loginReadyMs?: number;
    /**
     * Budget for ONE seed profile: applies to `command` and to `function`
     * each; default 300s (a full fixture takes longer than an env call).
     */
    seedMs?: number;
  };
  /** Runtime state (pid files, logs); default `.dev-contract`. */
  stateDir?: string;
};

/** Config after validation and defaulting; all consumers use this shape. */
export type ResolvedDevContractConfig = {
  root: string;
  appUrl: string;
  appPort: number;
  packageManager: string;
  commands: { convexDev: string; appDev: string };
  auth: {
    createTokenFunction: string;
    identity?: { issuer: string; subject: string };
    email: string;
    tokenArgs: Record<string, unknown>;
    verifyPath: string;
    sessionProbePath: string;
    callbackPath: string;
  };
  provision: {
    betterAuthSecret: boolean;
    devAuthFlag: boolean;
    siteUrl: boolean;
  };
  /**
   * Absent when the project configured no seed block (seeding skipped).
   * The top-level block of the raw config is `profiles.base`.
   */
  seed?: { profiles: Record<string, SeedProfile> };
  timeouts: {
    convexReadyMs: number;
    appReadyMs: number;
    loginReadyMs: number;
    seedMs: number;
  };
  stateDir: string;
};

/** Verified authenticated state handed to the pipeline. */
export type AuthState = {
  email: string;
  /** Ready-to-use `Cookie` request header value for `appUrl`. */
  cookie: string;
  /** Individual cookies from the verify response (name -> value). */
  cookies: Record<string, string>;
  /** `better-auth.convex_jwt` value for `ConvexHttpClient.setAuth()`. */
  convexJwt?: string;
  /** Fresh single-use browser login URL (verify endpoint + unused token). */
  loginUrl?: string;
};

/** Last stdout line of `dev-contract start`. */
export type StartOutput = {
  ok: true;
  /** Alias of `appUrl`, kept for the legacy `dev-start` JSON contract. */
  baseUrl: string;
  appUrl: string;
  convexUrl?: string;
  convexSiteUrl?: string;
  auth: AuthState;
  readyAt: string;
  pids: { convex?: number; app?: number };
  stateDir: string;
};

/** Last stdout line of `dev-contract auth`. */
export type AuthOutput = {
  ok: true;
  /** Top-level for the legacy `dev-auth` JSON contract. */
  loginUrl?: string;
  baseUrl: string;
  auth: AuthState;
};

/** Last stdout line of `dev-contract seed`. */
export type SeedOutput = {
  ok: true;
  /** The seed profile that ran (`base` unless `--profile` was given). */
  profile: string;
  /** Which configured seed variants actually ran, in execution order. */
  ran: Array<'command' | 'function'>;
};

export type ContractStep =
  | 'config'
  | 'guard'
  | 'convex-start'
  | 'convex-ready'
  | 'provision'
  | 'seed'
  | 'app-start'
  | 'app-ready'
  | 'mint-token'
  | 'verify'
  | 'session-probe'
  | 'login-ready'
  | 'stop';

/**
 * Every failure carries the step that broke — the pipeline (and the human
 * reading the log) must never have to guess which part of the contract
 * fell over. `ready` is only ever reported after `login-ready` passed.
 */
export class DevContractError extends Error {
  constructor(
    public readonly step: ContractStep,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`[${step}] ${message}`, options);
    this.name = 'DevContractError';
  }
}
