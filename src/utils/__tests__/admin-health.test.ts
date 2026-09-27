import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isAdminAddress,
  fetchProtocolHealth,
  setProtocolPaused,
  executeReadyProposals,
} from '../admin-health';
import { GOVERNANCE_ADMIN_ADDRESS } from '@/constants';

const getAllInvoicesMock = vi.fn();
const getNativeXlmBalanceMock = vi.fn();
vi.mock('@/utils/soroban', () => ({
  getAllInvoices: (...args: unknown[]) => getAllInvoicesMock(...args),
  getNativeXlmBalance: (...args: unknown[]) => getNativeXlmBalanceMock(...args),
}));

const fetchProposalsMock = vi.fn();
const executeProposalMock = vi.fn();
vi.mock('@/utils/governance', () => ({
  fetchProposals: (...args: unknown[]) => fetchProposalsMock(...args),
  executeProposal: (...args: unknown[]) => executeProposalMock(...args),
}));

describe('isAdminAddress', () => {
  it('returns true for the governance admin address', () => {
    expect(isAdminAddress(GOVERNANCE_ADMIN_ADDRESS)).toBe(true);
  });

  it('returns false for a different address', () => {
    expect(isAdminAddress('GSOMEONEELSE')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isAdminAddress(null)).toBe(false);
    expect(isAdminAddress(undefined)).toBe(false);
  });
});

describe('fetchProtocolHealth', () => {
  beforeEach(() => {
    getAllInvoicesMock.mockReset();
    getNativeXlmBalanceMock.mockReset();
    fetchProposalsMock.mockReset();
  });

  it('aggregates disputed invoices and pending/ready proposals', async () => {
    const now = Math.floor(Date.now() / 1000);
    getAllInvoicesMock.mockResolvedValue([
      { id: 1n, status: 'Disputed' },
      { id: 2n, status: 'Pending' },
    ]);
    fetchProposalsMock.mockResolvedValue([
      { id: 1, status: 'Active' },
      { id: 2, status: 'Pending' },
      { id: 3, status: 'Passed', executableAfter: now - 10 },
      { id: 4, status: 'Passed', executableAfter: now + 1000 },
      { id: 5, status: 'Passed' },
      { id: 6, status: 'Rejected' },
    ]);
    getNativeXlmBalanceMock.mockResolvedValue(500);

    const health = await fetchProtocolHealth();

    expect(health.disputedInvoices).toHaveLength(1);
    expect(health.pendingProposals).toHaveLength(2);
    expect(health.readyProposals.map((p) => p.id)).toEqual([3, 5]);
    expect(health.treasuryBalanceXlm).toBe(500);
    expect(health.paused).toBe(false);
  });

  it('falls back to a zero treasury balance when the balance fetch fails', async () => {
    getAllInvoicesMock.mockResolvedValue([]);
    fetchProposalsMock.mockResolvedValue([]);
    getNativeXlmBalanceMock.mockRejectedValue(new Error('rpc down'));

    const health = await fetchProtocolHealth();
    expect(health.treasuryBalanceXlm).toBe(0);
  });
});

describe('setProtocolPaused / fetchProtocolHealth interplay', () => {
  it('persists the paused flag across calls', async () => {
    getAllInvoicesMock.mockResolvedValue([]);
    fetchProposalsMock.mockResolvedValue([]);
    getNativeXlmBalanceMock.mockResolvedValue(0);

    const result = await setProtocolPaused(true, GOVERNANCE_ADMIN_ADDRESS, vi.fn());
    expect(result.paused).toBe(true);
    expect(result.txHash).toEqual(expect.any(String));

    const health = await fetchProtocolHealth();
    expect(health.paused).toBe(true);

    await setProtocolPaused(false, GOVERNANCE_ADMIN_ADDRESS, vi.fn());
  });
});

describe('executeReadyProposals', () => {
  it('executes every proposal and returns their results', async () => {
    executeProposalMock.mockImplementation(async (id: number) => ({ id, txHash: `tx-${id}` }));
    const proposals = [
      { id: 1, status: 'Passed' },
      { id: 2, status: 'Passed' },
    ] as any;

    const results = await executeReadyProposals(proposals, GOVERNANCE_ADMIN_ADDRESS, vi.fn());
    expect(results).toEqual([
      { id: 1, txHash: 'tx-1' },
      { id: 2, txHash: 'tx-2' },
    ]);
    expect(executeProposalMock).toHaveBeenCalledTimes(2);
  });
});
