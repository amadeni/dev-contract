import { DevContractError } from './types.js';

export type DeploymentGuardInput = {
  /** `CONVEX_DEPLOYMENT` from the process env or the project's env files. */
  deployment: string | undefined;
  /** `CONVEX_SELF_HOSTED_URL` if the project targets a self-hosted backend. */
  selfHostedUrl?: string | undefined;
};

export type DeploymentGuardResult =
  { ok: true; deployment: string } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/**
 * The provisioning gate: the contract writes env vars
 * (`AMADENI_DEV_AUTH_ENABLED=true`, `BETTER_AUTH_SECRET`, `SITE_URL`) onto
 * the deployment — that is only ever allowed against a Convex DEV
 * deployment. Allowed shapes:
 *
 * - `dev:<name>` — a personal cloud dev deployment
 * - `anonymous:<name>` — a local anonymous backend (inherently non-prod)
 *
 * Everything else (missing value, `prod:*`, `preview:*`, bare names,
 * self-hosted URLs on non-local hosts) is a hard refusal. This function is
 * pure so the refusal logic is unit-testable; callers turn a refusal into
 * a `DevContractError('guard', ...)` via `assertProvisioningAllowed`.
 */
export function checkProvisioningAllowed(
  input: DeploymentGuardInput,
): DeploymentGuardResult {
  const deployment = input.deployment?.trim() ?? '';
  if (!deployment) {
    return {
      ok: false,
      reason:
        'CONVEX_DEPLOYMENT is not set. The contract only provisions dev ' +
        'deployments (dev:* / anonymous:*).',
    };
  }
  if (!deployment.startsWith('dev:') && !deployment.startsWith('anonymous:')) {
    return {
      ok: false,
      reason:
        `CONVEX_DEPLOYMENT "${deployment}" is not a dev deployment ` +
        '(expected a dev: or anonymous: prefix). Refusing to provision ' +
        'dev-auth env vars — this could be production.',
    };
  }

  const selfHosted = input.selfHostedUrl?.trim();
  if (selfHosted) {
    let host: string;
    try {
      host = new URL(selfHosted).hostname.replace(/^\[|\]$/g, '');
    } catch {
      return {
        ok: false,
        reason: `CONVEX_SELF_HOSTED_URL is not a valid URL: ${selfHosted}`,
      };
    }
    if (!LOCAL_HOSTS.has(host.toLowerCase())) {
      return {
        ok: false,
        reason:
          `CONVEX_SELF_HOSTED_URL points at non-local host "${host}". ` +
          'Refusing to provision dev-auth env vars.',
      };
    }
  }

  return { ok: true, deployment };
}

export function assertProvisioningAllowed(input: DeploymentGuardInput): string {
  const result = checkProvisioningAllowed(input);
  if (!result.ok) {
    throw new DevContractError('guard', result.reason);
  }
  return result.deployment;
}
