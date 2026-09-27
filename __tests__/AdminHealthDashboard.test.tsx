import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminHealthDashboard from '@/app/admin/page';

// ── Audit log mock ─────────────────────────────────────────────────────────
const mockLogAdminAction = vi.fn();
vi.mock('@/lib/auditLog', () => ({
  logAdminAction: (...args: unknown[]) => mockLogAdminAction(...args),
}));

const adminAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const walletState = {
  address: adminAddress as string | null,
  signTx: vi.fn(),
};

const mockHealth = {
  paused: false,
  disputedInvoices: [
    {
      id: 1n,
      status: 'Disputed',
      freelancer: 'GFREELANCER',
      payer: 'GPAYER',
      amount: 100n,
      due_date: 1n,
      discount_rate: 100,
    },
  ],
  pendingProposals: [
    {
      id: 7,
      title: 'Update parameter',
      description: 'Update a protocol parameter.',
      type: 'ParameterUpdate',
      status: 'Active',
      proposer: 'GPROPOSER',
      createdAt: 1,
      votingStartsAt: 1,
      votingEndsAt: 2,
      votesFor: 0,
      votesAgainst: 0,
      quorumRequired: 10,
    },
  ],
  readyProposals: [
    {
      id: 3,
      title: 'Ready proposal',
      description: 'Ready to execute.',
      type: 'ProtocolUpgrade',
      status: 'Passed',
      proposer: 'GPROPOSER',
      createdAt: 1,
      votingStartsAt: 1,
      votingEndsAt: 2,
      executableAfter: 3,
      votesFor: 10,
      votesAgainst: 0,
      quorumRequired: 10,
    },
  ],
  oracleLastUpdatedAt: Math.floor(Date.now() / 1000) - 600,
  contractVersion: 'testnet:CD3TE3IA',
  upgradeWindowStartsAt: Math.floor(Date.now() / 1000) + 3 * 86_400,
  treasuryBalanceXlm: 123.45,
};

const mockAdminActions = [
  {
    id: 'sr-1',
    category: 'signer_rotation' as const,
    title: 'Multisig Signer Rotation',
    description: 'Multisig signer authority rotated from GCOEF7...567JKL to GAAAAA...AAAAWHF',
    actor: adminAddress,
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    txHash: 'a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    isSecuritySensitive: true,
    metadata: {
      oldSigner: 'GCOEF7LMN456OPQ789RST012UVW345XYZ678ABC901DEF234GHI567JKL',
      newSigner: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      reason: 'Quarterly multisig key rotation',
      action: 'rotated',
    },
  },
  {
    id: 'pu-1',
    category: 'parameter_update' as const,
    title: 'Parameter Updated: Protocol fee rate',
    description: "Routine parameter 'fee_rate_bps' updated to 30 (0.3%)",
    actor: adminAddress,
    timestamp: Math.floor(Date.now() / 1000) - 7200,
    isSecuritySensitive: false,
    metadata: {
      parameter: 'fee_rate_bps',
      newValue: '30 (0.3%)',
      proposalId: 7,
    },
  },
];

const fetchProtocolHealth = vi.fn();
const fetchAdminActionHistory = vi.fn();
const setProtocolPaused = vi.fn();
const executeReadyProposals = vi.fn();

vi.mock('@/context/WalletContext', () => ({
  useWallet: () => walletState,
}));

vi.mock('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

vi.mock('@/components/Footer', () => ({
  default: () => <footer data-testid="footer" />,
}));

vi.mock('@/utils/admin-health', () => ({
  fetchProtocolHealth: () => fetchProtocolHealth(),
  fetchAdminActionHistory: () => fetchAdminActionHistory(),
  setProtocolPaused: (...args: unknown[]) => setProtocolPaused(...args),
  executeReadyProposals: (...args: unknown[]) => executeReadyProposals(...args),
  isAdminAddress: (address: string | null | undefined) => address === adminAddress,
}));

// ── Token management mock ──────────────────────────────────────────────────
const mockApproveToken = vi.fn();
const mockRemoveToken = vi.fn();
const mockValidateTokenAddress = vi.fn();

const mockTokens = [
  {
    contractId: 'CUSDC0000000000000000000000000000000000000000000000000000',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 7,
    iconLabel: 'US',
    logo: '/tokens/usdc.svg',
    isAllowed: true,
  },
];

vi.mock('@/hooks/useApprovedTokens', () => ({
  useApprovedTokens: () => ({
    tokens: mockTokens,
    isLoading: false,
    approveToken: (...args: unknown[]) => mockApproveToken(...args),
    removeToken: (...args: unknown[]) => mockRemoveToken(...args),
    validateTokenAddress: (addr: string) => mockValidateTokenAddress(addr),
  }),
}));

vi.mock('@/components/admin/FunnelAnalyticsPanel', () => ({
  default: () => <div data-testid="funnel-analytics-panel" />,
}));

describe('AdminHealthDashboard', () => {
  beforeEach(() => {
    walletState.address = adminAddress;
    walletState.signTx.mockReset();
    fetchProtocolHealth.mockReset();
    fetchProtocolHealth.mockResolvedValue(mockHealth);
    fetchAdminActionHistory.mockReset();
    fetchAdminActionHistory.mockResolvedValue(mockAdminActions);
    setProtocolPaused.mockReset();
    setProtocolPaused.mockResolvedValue({ txHash: 'abc', paused: true });
    executeReadyProposals.mockReset();
    executeReadyProposals.mockResolvedValue(['tx']);
  });

  it('renders a 403 state for non-admin wallets', () => {
    walletState.address = 'GNOTADMIN';
    render(<AdminHealthDashboard />);
    expect(screen.getByText('403')).toBeInTheDocument();
    expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
    expect(fetchProtocolHealth).not.toHaveBeenCalled();
  });

  it('renders protocol health panels for the admin wallet', async () => {
    render(<AdminHealthDashboard />);
    expect(await screen.findByText('Protocol Health')).toBeInTheDocument();
    expect(screen.getByText('Protocol Status')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Open Disputes')).toBeInTheDocument();
    expect(screen.getByText('Pending Governance Proposals')).toBeInTheDocument();
    expect(screen.getByText('Oracle Last Updated')).toBeInTheDocument();
    expect(screen.getByText('Contract Version')).toBeInTheDocument();
    expect(screen.getByText('Treasury Balance')).toBeInTheDocument();
  });

  it('renders admin action audit log with distinct SignerRotated event security labeling', async () => {
    render(<AdminHealthDashboard />);

    expect(await screen.findByText('Admin Action Audit Log')).toBeInTheDocument();
    expect(await screen.findByText('Multisig Signer Rotation')).toBeInTheDocument();
    expect(screen.getByText('Security Critical')).toBeInTheDocument();
    expect(screen.getByText('Parameter Updated: Protocol fee rate')).toBeInTheDocument();
    expect(screen.getByText('Routine Parameter')).toBeInTheDocument();
    expect(screen.getByText(/Quarterly multisig key rotation/i)).toBeInTheDocument();
    expect(screen.getByText(/Previous Signer:/i)).toBeInTheDocument();
    expect(screen.getByText(/New Signer:/i)).toBeInTheDocument();
  });

  it('filters admin action audit log by category tabs', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);

    expect(await screen.findByText('Admin Action Audit Log')).toBeInTheDocument();
    expect(await screen.findByText('Multisig Signer Rotation')).toBeInTheDocument();
    expect(screen.getByText('Parameter Updated: Protocol fee rate')).toBeInTheDocument();

    // Filter to Signer Rotations only
    await user.click(screen.getByRole('button', { name: 'Signer Rotations (Security)' }));
    expect(screen.getByText('Multisig Signer Rotation')).toBeInTheDocument();
    expect(screen.queryByText('Parameter Updated: Protocol fee rate')).not.toBeInTheDocument();

    // Filter to Parameter Updates only
    await user.click(screen.getByRole('button', { name: 'Parameter Updates' }));
    expect(screen.queryByText('Multisig Signer Rotation')).not.toBeInTheDocument();
    expect(screen.getByText('Parameter Updated: Protocol fee rate')).toBeInTheDocument();
  });

  it('requires confirmation through the accessible dialog before pausing the protocol', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);
    await user.click(await screen.findByRole('button', { name: 'Pause' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    await user.click(within(dialog).getByRole('button', { name: 'Pause protocol' }));
    await waitFor(() => {
      expect(setProtocolPaused).toHaveBeenCalledWith(true, adminAddress, walletState.signTx);
    });
  });

  it('does not call admin actions when the confirmation dialog is cancelled', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);
    await user.click(await screen.findByRole('button', { name: 'Pause' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(setProtocolPaused).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

// ── Audit logging ─────────────────────────────────────────────────────────────

describe('AdminHealthDashboard — audit logging', () => {
  beforeEach(() => {
    walletState.address = adminAddress;
    walletState.signTx.mockReset();
    fetchProtocolHealth.mockReset();
    fetchProtocolHealth.mockResolvedValue(mockHealth);
    fetchAdminActionHistory.mockReset();
    fetchAdminActionHistory.mockResolvedValue(mockAdminActions);
    setProtocolPaused.mockReset();
    setProtocolPaused.mockResolvedValue({ txHash: 'abc', paused: true });
    executeReadyProposals.mockReset();
    executeReadyProposals.mockResolvedValue(['tx']);
    mockLogAdminAction.mockReset();
    mockApproveToken.mockReset();
    mockRemoveToken.mockReset();
    mockValidateTokenAddress.mockReset();
    mockValidateTokenAddress.mockReturnValue(true);
  });

  it('emits protocol.pause_requested before the confirmation dialog appears', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);
    await user.click(await screen.findByRole('button', { name: 'Pause' }));

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'protocol.pause_requested',
        actor: adminAddress,
        page: '/admin',
      })
    );
    await screen.findByRole('dialog');
  });

  it('emits protocol.pause_confirmed then protocol.pause_succeeded on successful pause', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Pause protocol' }));

    await waitFor(() => {
      expect(setProtocolPaused).toHaveBeenCalledTimes(1);
    });

    const actions = mockLogAdminAction.mock.calls.map(([p]) => p.action);
    expect(actions).toContain('protocol.pause_confirmed');
    expect(actions).toContain('protocol.pause_succeeded');
  });

  it('emits protocol.pause_failed when setProtocolPaused rejects', async () => {
    setProtocolPaused.mockRejectedValue(new Error('RPC error'));
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Pause protocol' }));

    await waitFor(() => {
      const actions = mockLogAdminAction.mock.calls.map(([p]) => p.action);
      expect(actions).toContain('protocol.pause_failed');
    });
  });

  it('emits governance.execute_requested before the execute proposals dialog', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);
    await user.click(await screen.findByRole('button', { name: 'Execute Ready Proposals' }));

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'governance.execute_requested',
        actor: adminAddress,
        page: '/admin',
      })
    );
    await screen.findByRole('dialog');
  });

  it('emits governance.execute_confirmed then governance.execute_succeeded on confirm', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);
    await user.click(await screen.findByRole('button', { name: 'Execute Ready Proposals' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Execute proposals' }));

    await waitFor(() => {
      expect(executeReadyProposals).toHaveBeenCalledTimes(1);
    });

    const actions = mockLogAdminAction.mock.calls.map(([p]) => p.action);
    expect(actions).toContain('governance.execute_confirmed');
    expect(actions).toContain('governance.execute_succeeded');
  });

  it('emits governance.execute_failed when executeReadyProposals rejects', async () => {
    executeReadyProposals.mockRejectedValue(new Error('contract error'));
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);
    await user.click(await screen.findByRole('button', { name: 'Execute Ready Proposals' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Execute proposals' }));

    await waitFor(() => {
      const actions = mockLogAdminAction.mock.calls.map(([p]) => p.action);
      expect(actions).toContain('governance.execute_failed');
    });
  });
});

// ── Token management ──────────────────────────────────────────────────────────

describe('AdminHealthDashboard — token management', () => {
  const VALID_TOKEN_ID = 'CNEWTOKEN000000000000000000000000000000000000000000000000';

  beforeEach(() => {
    walletState.address = adminAddress;
    walletState.signTx.mockReset();
    fetchProtocolHealth.mockReset();
    fetchProtocolHealth.mockResolvedValue(mockHealth);
    fetchAdminActionHistory.mockReset();
    fetchAdminActionHistory.mockResolvedValue(mockAdminActions);
    setProtocolPaused.mockReset();
    setProtocolPaused.mockResolvedValue({ txHash: 'abc', paused: true });
    executeReadyProposals.mockReset();
    executeReadyProposals.mockResolvedValue(['tx']);
    mockLogAdminAction.mockReset();
    mockApproveToken.mockReset();
    mockApproveToken.mockResolvedValue('signed-xdr');
    mockRemoveToken.mockReset();
    mockRemoveToken.mockResolvedValue('signed-xdr');
    mockValidateTokenAddress.mockReset();
    mockValidateTokenAddress.mockReturnValue(true);
  });

  it('renders the approved tokens section with a token address input', async () => {
    render(<AdminHealthDashboard />);
    expect(await screen.findByLabelText('Token Contract Address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve Token' })).toBeInTheDocument();
  });

  it('renders the USDC token in the approved list', async () => {
    render(<AdminHealthDashboard />);
    expect(await screen.findByText('USDC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove USDC' })).toBeInTheDocument();
  });

  it('calls approveToken after submitting a valid address', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);

    const input = await screen.findByLabelText('Token Contract Address');
    await user.type(input, VALID_TOKEN_ID);
    await user.click(screen.getByRole('button', { name: 'Approve Token' }));

    await waitFor(() => {
      expect(mockApproveToken).toHaveBeenCalledWith(
        adminAddress,
        VALID_TOKEN_ID,
        walletState.signTx
      );
    });
  });

  it('shows a validation error for an invalid token address without calling approveToken', async () => {
    mockValidateTokenAddress.mockReturnValue(false);
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);

    const input = await screen.findByLabelText('Token Contract Address');
    await user.type(input, 'BADADDRESS');
    await user.click(screen.getByRole('button', { name: 'Approve Token' }));

    expect(mockApproveToken).not.toHaveBeenCalled();
    expect(await screen.findByText(/Enter a valid Stellar contract address/i)).toBeInTheDocument();
  });

  it('emits token.approve_submitted and token.approve_succeeded audit events on success', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);

    const input = await screen.findByLabelText('Token Contract Address');
    await user.type(input, VALID_TOKEN_ID);
    await user.click(screen.getByRole('button', { name: 'Approve Token' }));

    await waitFor(() => {
      const actions = mockLogAdminAction.mock.calls.map(([p]) => p.action);
      expect(actions).toContain('token.approve_submitted');
      expect(actions).toContain('token.approve_succeeded');
    });
  });

  it('emits token.approve_failed when approveToken rejects', async () => {
    mockApproveToken.mockRejectedValue(new Error('ledger rejected'));
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);

    const input = await screen.findByLabelText('Token Contract Address');
    await user.type(input, VALID_TOKEN_ID);
    await user.click(screen.getByRole('button', { name: 'Approve Token' }));

    await waitFor(() => {
      const actions = mockLogAdminAction.mock.calls.map(([p]) => p.action);
      expect(actions).toContain('token.approve_failed');
    });
  });

  it('opens a remove-token confirmation dialog when Remove button is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);

    await user.click(await screen.findByRole('button', { name: 'Remove USDC' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Remove approved token/i)).toBeInTheDocument();
  });

  it('emits token.remove_requested before the confirmation dialog', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);

    await user.click(await screen.findByRole('button', { name: 'Remove USDC' }));
    await screen.findByRole('dialog');

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'token.remove_requested',
        actor: adminAddress,
        page: '/admin',
      })
    );
  });

  it('calls removeToken and emits token.remove_confirmed/succeeded after confirming', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);

    await user.click(await screen.findByRole('button', { name: 'Remove USDC' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove token' }));

    await waitFor(() => {
      expect(mockRemoveToken).toHaveBeenCalledTimes(1);
    });

    const actions = mockLogAdminAction.mock.calls.map(([p]) => p.action);
    expect(actions).toContain('token.remove_confirmed');
    expect(actions).toContain('token.remove_succeeded');
  });

  it('emits token.remove_failed when removeToken rejects', async () => {
    mockRemoveToken.mockRejectedValue(new Error('contract reject'));
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);

    await user.click(await screen.findByRole('button', { name: 'Remove USDC' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove token' }));

    await waitFor(() => {
      const actions = mockLogAdminAction.mock.calls.map(([p]) => p.action);
      expect(actions).toContain('token.remove_failed');
    });
  });

  it('cancels the remove-token dialog without calling removeToken', async () => {
    const user = userEvent.setup();
    render(<AdminHealthDashboard />);

    await user.click(await screen.findByRole('button', { name: 'Remove USDC' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(mockRemoveToken).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
