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
  timeouts?: {
    /** Waiting for the Convex dev deployment to answer; default 120s. */
    convexReadyMs?: number;
    /** Waiting for the app dev server to answer HTTP; default 120s. */
    appReadyMs?: number;
    /** Waiting for a VERIFIED login (the readiness gate); default 90s. */
    loginReadyMs?: number;
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
  timeouts: { convexReadyMs: number; appReadyMs: number; loginReadyMs: number };
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

export type ContractStep =
  | 'config'
  | 'guard'
  | 'convex-start'
  | 'convex-ready'
  | 'provision'
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
