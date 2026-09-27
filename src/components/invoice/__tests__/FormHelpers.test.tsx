import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Field, PreviewRow, formatMiddle } from '../FormHelpers';

// FieldTooltip uses Radix Tooltip — stub it to avoid needing a full provider.
vi.mock('@/components/FieldTooltip', () => ({
  default: ({ content }: { content: React.ReactNode }) => (
    <span data-testid="field-tooltip">{content}</span>
  ),
}));

// TokenAmount is a named export from TokenSelector used inside PreviewRow.
vi.mock('@/components/TokenSelector', () => ({
  TokenAmount: ({
    amount,
    token,
    className,
  }: {
    amount: string;
    token: { symbol: string };
    className?: string;
  }) => (
    <span className={className} data-testid="token-amount">
      {amount} {token.symbol}
    </span>
  ),
}));

// ---------------------------------------------------------------------------
// formatMiddle
// ---------------------------------------------------------------------------
describe('formatMiddle', () => {
  it('returns "-" for an empty string', () => {
    expect(formatMiddle('')).toBe('-');
  });

  it('returns the value unchanged when it is 14 chars or fewer', () => {
    expect(formatMiddle('GABCDEF')).toBe('GABCDEF');
    expect(formatMiddle('GABCDEFGHIJKLMN'.slice(0, 14))).toHaveLength(14);
  });

  it('truncates long values with an ellipsis in the middle', () => {
    const long = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
    const result = formatMiddle(long);
    expect(result).toContain('...');
    expect(result).toBe(`${long.slice(0, 6)}...${long.slice(-6)}`);
  });
});

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------
describe('Field', () => {
  it('renders its label and children', () => {
    render(
      <Field label="Invoice amount">
        <input data-testid="child-input" />
      </Field>
    );
    expect(screen.getByText('Invoice amount')).toBeInTheDocument();
    expect(screen.getByTestId('child-input')).toBeInTheDocument();
  });

  it('renders an error message when error prop is provided', () => {
    render(
      <Field label="Due date" error="Date is required" errorId="due-date-error">
        <input />
      </Field>
    );
    const errorEl = screen.getByText('Date is required');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl).toHaveAttribute('id', 'due-date-error');
  });

  it('renders a hint when hint prop is provided', () => {
    render(
      <Field label="Payer" hint="Enter a valid Stellar address">
        <input />
      </Field>
    );
    expect(screen.getByText('Enter a valid Stellar address')).toBeInTheDocument();
  });

  it('renders a tooltip when tooltip prop is provided', () => {
    render(
      <Field label="Discount rate" tooltip="How much you give up for instant payment">
        <input />
      </Field>
    );
    expect(screen.getByTestId('field-tooltip')).toBeInTheDocument();
  });

  it('renders neither error nor hint when neither is provided', () => {
    const { container } = render(
      <Field label="Payer">
        <input />
      </Field>
    );
    // No <p> elements for error or hint
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PreviewRow
// ---------------------------------------------------------------------------
describe('PreviewRow', () => {
  it('renders label and plain value', () => {
    render(<PreviewRow label="Payer" value="GABCD...XYZ" />);
    expect(screen.getByText('Payer')).toBeInTheDocument();
    expect(screen.getByText('GABCD...XYZ')).toBeInTheDocument();
  });

  it('applies accent class when accent prop is true', () => {
    render(<PreviewRow label="You will receive" value="950" accent />);
    const valueEl = screen.getByText('950');
    expect(valueEl.className).toContain('text-primary');
  });

  it('applies non-accent class when accent is false', () => {
    render(<PreviewRow label="LP yield" value="3.00%" accent={false} />);
    const valueEl = screen.getByText('3.00%');
    expect(valueEl.className).toContain('text-on-surface');
  });

  it('renders TokenAmount when a token is provided', () => {
    const token = {
      symbol: 'USDC',
      iconLabel: 'USDC',
      contractId: 'CTEST',
      name: 'USD Coin',
      decimals: 7,
    };
    render(<PreviewRow label="You receive" value="950" token={token} />);
    // TokenAmount renders with the amount value — assert via testid to avoid
    // splitting across child elements.
    expect(screen.getByTestId('token-amount')).toBeInTheDocument();
    expect(screen.getByTestId('token-amount').textContent).toContain('950');
  });
});
