# @amadeni/dev-contract

Standardized dev-start/dev-auth process contract for the Amadeni project
fleet. One CLI replaces the per-repo shell scripts (`dev-start.sh` /
`dev-auth.sh` / `dev-stop.sh`) that every project used to copy — with one
core guarantee the scripts never gave:

> **ready = verified login.** `dev-contract start` only reports ready
> after a dev login has DEMONSTRABLY worked: it mints a single-use token,
> consumes it at the magic link verify endpoint, and replays the issued
> cookies against an authenticated probe until the response proves a live
> session. The pipeline receives a ready-made authenticated state
> (cookies + Convex JWT), not just URLs — the "screenshot shows the login
> screen instead of the app" failure mode cannot pass the gate.

## What `start` does

1. Starts `convex dev` (detached process group, pid + log files in
   `.dev-contract/`). Fresh checkouts get `CONVEX_AGENT_MODE=anonymous` so
   Convex picks a local anonymous deployment without prompting.
2. **Guard (hard abort):** provisioning only ever happens against a
   `dev:*` or `anonymous:*` `CONVEX_DEPLOYMENT` (and only local
   `CONVEX_SELF_HOSTED_URL` hosts). Anything else exits non-zero before a
   single env var is written.
3. Provisions missing dev env vars on the Convex deployment:
   `AMADENI_DEV_AUTH_ENABLED=true`, a generated `BETTER_AUTH_SECRET`, and
   `SITE_URL` — reconciled on every start, so repaired environments heal.
4. Starts the app dev server and waits for HTTP.
5. **Readiness gate:** retries mint → verify → session-probe until the
   login is verified (or the deadline passes — then it fails loudly with
   the step that broke). A second, unused token becomes `auth.loginUrl`
   for browser consumers.
6. Emits the contract JSON as the **last stdout line** (all logging goes
   to stderr):

```json
{
  "ok": true,
  "baseUrl": "http://localhost:3001",
  "appUrl": "http://localhost:3001",
  "convexUrl": "https://<deployment>.convex.cloud",
  "convexSiteUrl": "https://<deployment>.convex.site",
  "auth": {
    "email": "dev@amadeni.local",
    "cookie": "better-auth.session_token=...; better-auth.convex_jwt=...",
    "cookies": {
      "better-auth.session_token": "...",
      "better-auth.convex_jwt": "..."
    },
    "convexJwt": "<decoded JWT for ConvexHttpClient.setAuth()>",
    "loginUrl": "http://localhost:3001/api/auth/magic-link/verify?token=..."
  },
  "readyAt": "2026-01-02T03:04:05.000Z",
  "pids": { "convex": 123, "app": 456 },
  "stateDir": "/abs/path/.dev-contract"
}
```

Failures never emit `ok: true`: the process exits non-zero with a
`[step]`-prefixed diagnosis on stderr (`guard`, `convex-ready`,
`provision`, `app-ready`, `mint-token`, `verify`, `session-probe`,
`login-ready`, ...).

## Commands

```bash
dev-contract start [--config path] [--email x] [--out file] [--root dir]
dev-contract auth   # fresh verified session for a running environment
dev-contract stop   # stop the process groups started by `start`
```

`auth` emits `{ "ok": true, "loginUrl": ..., "baseUrl": ..., "auth": {...} }`;
`stop` emits `{ "ok": true, "stopped": [...] }`.

## Project integration

### 1. Config: `devcontract.config.json` in the repo root

See [`devcontract.config.example.json`](./devcontract.config.example.json).
Minimal version:

```json
{
  "appUrl": "http://localhost:3001",
  "auth": {
    "createTokenFunction": "dev/auth:createDevToken",
    "identity": { "issuer": "my-app-dev-auth", "subject": "dev-auth-cli" }
  }
}
```

Everything else has defaults (`pnpm`, `convex dev`, `next dev -p <port>`,
better-auth verify/get-session paths, 120s/120s/90s timeouts).

### 2. Convex-side fixture: `createDevAuth` from `@amadeni/better-auth-kit`

The token function referenced by `auth.createTokenFunction` lives in the
app's `convex/` directory and is a thin wiring of the kit factory
(v0.3.0+). It writes a hashed magic-link verification row directly into
the Better Auth component — the login then runs through the app's regular
verify endpoint, with real sessions and cookies:

```ts
// convex/dev/auth.ts
import { v } from 'convex/values';
import {
  createDevAuth,
  requireDevAuthCliIdentity,
} from '@amadeni/better-auth-kit';
import { action } from '../_generated/server';
import { components, internal } from '../_generated/api';

const devAuth = createDevAuth({
  createVerification: (ctx, input) =>
    ctx.runMutation(components.betterAuth.adapter.create, { input }),
  ensureUser: (ctx, { email, name }) =>
    ctx.runMutation(internal.dev.auth.ensureDevUserInternal, { email, name }),
});

export const createDevToken = action({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireDevAuthCliIdentity(ctx, {
      issuer: 'my-app-dev-auth', // must match devcontract.config.json
      subject: 'dev-auth-cli',
    });
    return await devAuth.issueToken(ctx, args);
  },
});
```

The kit enforces the hard gate: minting throws unless
`AMADENI_DEV_AUTH_ENABLED === 'true'`, and always throws on
production-shaped deployments. **Never set that variable on production.**

Apps with existing dev-auth actions (e.g. the Hub's
`dev/auth:createDevToken`) work as-is — the contract only requires "takes
`{ email? }`, returns `{ token }`".

### 3. Optional: keep the `just` recipes as thin wrappers

```just
dev-start:
    pnpm exec dev-contract start

dev-auth:
    pnpm exec dev-contract auth

dev-stop:
    pnpm exec dev-contract stop
```

## Consumer notes (Mynd / pipelines)

- **Legacy compatibility:** the previous shell contract emitted
  `{"baseUrl": ...}` (dev-start) and `{"loginUrl": ...}` (dev-auth) as the
  last stdout line. The new output is a strict superset: `baseUrl` stays
  top-level in `start`, `loginUrl` stays top-level in `auth`. Existing
  parsers (`parseDevStartOutput` / `parseDevAuthOutput`) keep working
  unchanged.
- **The upgrade:** consumers should switch from "open loginUrl and hope"
  to injecting the delivered state directly — set `auth.cookie` as the
  `Cookie` header (or seed the browser context's cookies) and/or use
  `auth.convexJwt` with `ConvexHttpClient.setAuth()`. `loginUrl` remains
  for pure-browser flows; it carries a fresh unused single-use token.
- **Trust the exit code, not the log tail:** exit 0 + last-line JSON with
  `ok: true` is the only ready signal; the JSON is only emitted after the
  verified-login gate passed. On failure the exit code is non-zero and
  stderr names the failing step.
- `start` is idempotent: running processes are reused, env state is
  re-reconciled, and the login is re-verified on every call — safe to call
  once per review iteration.

## Programmatic use

```ts
import { loadConfig, runStart } from '@amadeni/dev-contract';

const config = await loadConfig(projectRoot);
const result = await runStart(config); // throws DevContractError with .step
```

## Security posture

- Provisioning is hard-gated to `dev:*` / `anonymous:*` deployments —
  the CLI refuses everything else before writing anything.
- The dev login itself is additionally gated Convex-side by
  `@amadeni/better-auth-kit`'s `assertDevAuthEnabled` (exact-match env
  flag + production-shape refusal).
- Zero runtime dependencies; Node >= 20.

## Development

```bash
pnpm install
pnpm run ci    # prettier + eslint + tsc + cspell + vitest
```
