/**
 * Regression tests for the admin authorization gate (#916).
 *
 * These tests pin the server-side-enforcement finding from #915: a non-admin
 * wallet address must be denied by `requireAdmin()` / `assertAdminAddress()`
 * with an explicit 403-shaped rejection, so the gate cannot silently regress
 * to an allow-by-default check.
 */

import { describe, expect, it } from 'vitest';
import {
  ADMIN_ACCESS_DENIED_CODE,
  adminForbiddenResponse,
  assertAdminAddress,
  isAdminAddressFromValue,
  requireAdmin,
} from '../admin-gate';
import { GOVERNANCE_ADMIN_ADDRESS } from '@/constants';

const ADMIN = GOVERNANCE_ADMIN_ADDRESS;
const NON_ADMIN = 'GBNONADMINWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBB';
const OTHER_NON_ADMIN = 'GCDIFFERENTNONADMINWALLETAAAAAAAAAAAAAAAAAAAAAACCC';

describe('isAdminAddressFromValue', () => {
  it('accepts the configured admin address', () => {
    expect(isAdminAddressFromValue(ADMIN, ADMIN)).toBe(true);
  });

  it('rejects a non-admin address', () => {
    expect(isAdminAddressFromValue(NON_ADMIN, ADMIN)).toBe(false);
  });

  it('rejects null and undefined (disconnected wallet)', () => {
    expect(isAdminAddressFromValue(null, ADMIN)).toBe(false);
    expect(isAdminAddressFromValue(undefined, ADMIN)).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isAdminAddressFromValue('', ADMIN)).toBe(false);
  });

  it('is an exact match — case variants and affixes do not pass', () => {
    expect(isAdminAddressFromValue(ADMIN.toLowerCase(), ADMIN)).toBe(false);
    expect(isAdminAddressFromValue(` ${ADMIN}`, ADMIN)).toBe(false);
    expect(isAdminAddressFromValue(`${ADMIN} `, ADMIN)).toBe(false);
  });

  it('rejects every non-admin address, not just one fixture', () => {
    expect(isAdminAddressFromValue(OTHER_NON_ADMIN, ADMIN)).toBe(false);
  });
});

describe('requireAdmin', () => {
  it('grants the admin address', () => {
    const decision = requireAdmin(ADMIN, ADMIN);
    expect(decision).toEqual({ authorized: true, adminAddress: ADMIN });
  });

  it('denies a non-admin address with a 403-shaped denial', () => {
    const decision = requireAdmin(NON_ADMIN, ADMIN);
    expect(decision).toEqual({
      authorized: false,
      status: 403,
      code: ADMIN_ACCESS_DENIED_CODE,
      message: expect.any(String),
    });
  });

  it('denies a disconnected wallet (null/undefined)', () => {
    for (const address of [null, undefined] as const) {
      const decision = requireAdmin(address, ADMIN);
      expect(decision.authorized).toBe(false);
      if (!decision.authorized) {
        expect(decision.status).toBe(403);
      }
    }
  });

  it('defaults to the configured governance admin address', () => {
    expect(requireAdmin(ADMIN).authorized).toBe(true);
    expect(requireAdmin(NON_ADMIN).authorized).toBe(false);
  });
});

describe('assertAdminAddress', () => {
  it('does not throw for the admin address', () => {
    expect(() => assertAdminAddress(ADMIN, ADMIN)).not.toThrow();
  });

  it('throws for a non-admin address', () => {
    expect(() => assertAdminAddress(NON_ADMIN, ADMIN)).toThrow(/admin access required/i);
  });

  it('throws for a disconnected wallet', () => {
    expect(() => assertAdminAddress(null, ADMIN)).toThrow(/admin access required/i);
    expect(() => assertAdminAddress(undefined, ADMIN)).toThrow(/admin access required/i);
  });
});

describe('adminForbiddenResponse', () => {
  it('returns HTTP 403 with the machine-readable denial code', async () => {
    const decision = requireAdmin(NON_ADMIN, ADMIN);
    expect(decision.authorized).toBe(false);
    if (decision.authorized) throw new Error('unreachable');
    const response = adminForbiddenResponse(decision);
    expect(response.status).toBe(403);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      error: ADMIN_ACCESS_DENIED_CODE,
      message: expect.any(String),
    });
  });
});
