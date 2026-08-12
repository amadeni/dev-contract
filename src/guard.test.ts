import { describe, expect, it } from 'vitest';
import {
  assertProvisioningAllowed,
  checkProvisioningAllowed,
} from './guard.js';
import { DevContractError } from './types.js';

describe('checkProvisioningAllowed', () => {
  it('allows dev: deployments', () => {
    expect(
      checkProvisioningAllowed({ deployment: 'dev:calm-otter-123' }),
    ).toEqual({ ok: true, deployment: 'dev:calm-otter-123' });
  });

  it('allows anonymous: local deployments', () => {
    expect(
      checkProvisioningAllowed({ deployment: 'anonymous:my-worktree' }).ok,
    ).toBe(true);
  });

  it.each([
    undefined,
    '',
    '   ',
    'prod:amadeni-hub',
    'production:x',
    'preview:pr-123',
    'my-deployment',
    'Dev:calm-otter', // prefix is case-sensitive on purpose
  ])('refuses %j', deployment => {
    const result = checkProvisioningAllowed({ deployment });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/CONVEX_DEPLOYMENT/);
    }
  });

  it('refuses self-hosted URLs on non-local hosts even for dev: deployments', () => {
    const result = checkProvisioningAllowed({
      deployment: 'dev:x',
      selfHostedUrl: 'https://convex.customer-domain.example',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/non-local host/);
  });

  it.each([
    'http://localhost:3210',
    'http://127.0.0.1:3210',
    'http://[::1]:3210',
  ])('allows local self-hosted URL %s', selfHostedUrl => {
    expect(
      checkProvisioningAllowed({ deployment: 'anonymous:x', selfHostedUrl }).ok,
    ).toBe(true);
  });

  it('refuses malformed self-hosted URLs', () => {
    expect(
      checkProvisioningAllowed({ deployment: 'dev:x', selfHostedUrl: '::' }).ok,
    ).toBe(false);
  });
});

describe('assertProvisioningAllowed', () => {
  it('throws a guard-step DevContractError on refusal', () => {
    try {
      assertProvisioningAllowed({ deployment: 'prod:hub' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DevContractError);
      expect((error as DevContractError).step).toBe('guard');
    }
  });

  it('returns the deployment on success', () => {
    expect(assertProvisioningAllowed({ deployment: 'dev:x' })).toBe('dev:x');
  });
});
