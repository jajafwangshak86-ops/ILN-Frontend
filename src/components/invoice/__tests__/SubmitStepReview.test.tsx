import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SubmitStepReview from '../SubmitStepReview';
import type { InvoiceFormValues } from '@/utils/invoiceSubmission';

// Stub PreviewRow so we can assert on labels without needing deep rendering.
vi.mock('../FormHelpers', () => ({
  PreviewRow: ({
    label,
    value,
  }: {
    label: string;
    value: string;
    token?: unknown;
    accent?: boolean;
  }) => (
    <div data-testid="preview-row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
  formatMiddle: (v: string) => (v ? `${v.slice(0, 6)}...` : '-'),
}));

vi.mock('@/utils/invoiceSubmission', () => ({
  getYieldPreview: (_amount: string, _rate: string) => ({
    payoutFormatted: '970.00',
    discountRatePercent: 3.0,
    yieldFormatted: '30.00',
  }),
}));

vi.mock('@/utils/token-amount-input', () => ({
  getTokenInputDecimals: () => 7,
}));

const baseForm: InvoiceFormValues = {
  payer: 'GABCDEFGHIJKLMNO',
  amount: '1000',
  dueDate: '2026-12-01',
  discountRate: '300',
  tokenId: 'CTEST',
  memo: '',
};

const baseToken = {
  symbol: 'USDC',
  decimals: 7,
  iconLabel: 'USDC',
  contractId: 'CTEST',
  name: 'USD Coin',
};

describe('SubmitStepReview', () => {
  it('renders the "Review & Submit" heading', () => {
    render(<SubmitStepReview form={baseForm} selectedToken={baseToken} />);
    expect(screen.getByText('Review & Submit')).toBeInTheDocument();
  });

  it('renders Payer, Due date, payout, and LP yield preview rows', () => {
    render(<SubmitStepReview form={baseForm} selectedToken={baseToken} />);
    const rows = screen.getAllByTestId('preview-row');
    const labels = rows.map((r) => r.querySelector('span')?.textContent);
    expect(labels).toContain('Payer');
    expect(labels).toContain('Due date');
    expect(labels).toContain('You will receive');
    expect(labels).toContain('LP yield is');
  });

  it('displays the due date value', () => {
    render(<SubmitStepReview form={baseForm} selectedToken={baseToken} />);
    expect(screen.getByText('2026-12-01')).toBeInTheDocument();
  });

  it('shows the wallet confirmation reminder notice', () => {
    render(<SubmitStepReview form={baseForm} selectedToken={baseToken} />);
    expect(screen.getByText(/Your wallet will ask you to confirm/i)).toBeInTheDocument();
  });

  it('renders without a selected token (null)', () => {
    render(<SubmitStepReview form={baseForm} selectedToken={null} />);
    expect(screen.getByText('Review & Submit')).toBeInTheDocument();
  });
});
