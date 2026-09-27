'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApprovedToken } from '@/hooks/useApprovedTokens';
import { useBalances, type TokenBalanceMap } from '@/hooks/useBalances';
import { formatTokenAmount } from '@/utils/format';
import FieldTooltip from './FieldTooltip';
import { getXlmPrecisionNote } from '@/utils/token-amount-input';

type TokenLike =
  | ApprovedToken
  | (Partial<ApprovedToken> & Pick<ApprovedToken, 'contractId' | 'symbol' | 'decimals'>);

interface TokenAvailability {
  isAllowed?: boolean;
  unavailableReason?: string;
}

interface TokenSelectorProps {
  label: string;
  tooltip?: string | ReactNode;
  value: string;
  tokens: TokenLike[];
  error?: string;
  hint?: string;
  disabled?: boolean;
  readOnly?: boolean;
  showBalances?: boolean;
  onChange?: (value: string) => void;
}

interface BaseTokenSelectorProps extends TokenSelectorProps {
  balances?: TokenBalanceMap;
  balancesLoading?: boolean;
}

function tokenAccentClasses(symbol: string): string {
  switch (symbol) {
    case 'EURC':
      return 'bg-sky-100 text-sky-700 border-sky-200';
    case 'XLM':
      return 'bg-zinc-900 text-white border-zinc-700';
    case 'USDC':
      return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    default:
      return 'bg-surface-container-high text-on-surface border-outline-variant/20';
  }
}

function getTokenName(token: Partial<TokenLike> & { symbol?: string; name?: string }): string {
  return token.name ?? token.symbol ?? 'Token';
}

function getTokenLogo(token: Partial<TokenLike> & { symbol?: string; logo?: string }): string {
  const symbol = token.symbol ?? 'unknown';
  return token.logo ?? `/tokens/${symbol.toLowerCase()}.svg`;
}

function getTokenIconLabel(
  token: Partial<TokenLike> & { symbol?: string; iconLabel?: string }
): string {
  const sym = token.symbol ?? 'TK';
  return (
    token.iconLabel ??
    (sym
      .replace(/[^A-Z0-9]/gi, '')
      .slice(0, 2)
      .toUpperCase() ||
      'TK')
  );
}

function isTokenAllowed(token: Partial<TokenLike> & TokenAvailability): boolean {
  return token.isAllowed ?? true;
}

function getUnavailableReason(token: Partial<TokenLike> & TokenAvailability): string {
  return (
    token.unavailableReason ?? 'This token is not currently available for ILN invoices.'
  );
}

function chooseSelectedToken(tokens: TokenLike[], value: string) {
  return (
    tokens.find((token) => token.contractId === value) ??
    tokens.find((token) => token.symbol === 'USDC' && isTokenAllowed(token)) ??
    tokens.find(isTokenAllowed) ??
    tokens[0] ??
    null
  );
}

export function TokenIcon({
  token,
  className = '',
}: {
  token: Pick<TokenLike, 'iconLabel' | 'logo' | 'symbol'>;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border text-[11px] font-black tracking-[0.14em] ${tokenAccentClasses(
        token.symbol
      )} ${className}`}
      aria-hidden="true"
    >
      {/* SVG token marks are tiny static assets; Next image optimization is unnecessary here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getTokenLogo(token)}
        alt=""
        className="h-full w-full object-cover"
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
      <span className="sr-only">{getTokenIconLabel(token)}</span>
    </span>
  );
}

export function TokenAmount({
  amount,
  token,
  className = '',
}: {
  amount: string;
  token: TokenLike;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <TokenIcon token={token} className="h-6 w-6 text-[9px]" />
      <span>{amount}</span>
    </span>
  );
}

export default function TokenSelector(props: TokenSelectorProps) {
  if (props.showBalances) {
    return <BalanceAwareTokenSelector {...props} />;
  }

  return <BaseTokenSelector {...props} />;
}

function BalanceAwareTokenSelector(props: TokenSelectorProps) {
  const balanceTokens = useMemo(
    () =>
      props.tokens.map((token) => ({
        ...token,
        name: getTokenName(token),
        iconLabel: getTokenIconLabel(token),
        logo: getTokenLogo(token),
        isAllowed: isTokenAllowed(token),
      })) as ApprovedToken[],
    [props.tokens]
  );
  const { balances, isLoading } = useBalances(balanceTokens, props.showBalances);

  return <BaseTokenSelector {...props} balances={balances} balancesLoading={isLoading} />;
}

function BaseTokenSelector({
  label,
  tooltip,
  value,
  tokens,
  error,
  hint,
  disabled,
  readOnly = false,
  onChange,
  balances,
  balancesLoading = false,
}: BaseTokenSelectorProps) {
  const selectorId = useId();
  const listboxId = `${selectorId}-listbox`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const selectedToken = chooseSelectedToken(tokens, value);
  const interactiveDisabled = disabled || tokens.length === 0;

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!open || isMobile) return;

    function handlePointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, isMobile]);

  // Prevent body scroll when bottom sheet is open on mobile
  useEffect(() => {
    if (isMobile && open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobile, open]);

  const selectToken = (token: TokenLike) => {
    if (!isTokenAllowed(token) || disabled || readOnly) return;
    onChange?.(token.contractId);
    setOpen(false);
  };

  const selectedBalance = selectedToken ? balances?.get(selectedToken.contractId) : undefined;

  const tokenList = (
    <div id={listboxId} role="listbox" aria-labelledby={selectorId}>
      {tokens.map((token) => {
        const allowed = isTokenAllowed(token);
        const selected = selectedToken?.contractId === token.contractId;
        const balance = balances?.get(token.contractId);

        return (
          <button
            key={token.contractId}
            type="button"
            role="option"
            aria-selected={selected}
            aria-disabled={!allowed}
            title={allowed ? undefined : getUnavailableReason(token)}
            onClick={() => selectToken(token)}
            className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
              allowed
                ? 'hover:bg-surface-container-low active:bg-surface-container-high'
                : 'cursor-not-allowed grayscale opacity-50'
            } ${selected ? 'bg-primary-container/40' : ''}`}
          >
            <TokenDisplay
              token={token}
              balance={balance}
              balancesLoading={balancesLoading}
              showBalance={Boolean(balances)}
              unavailableReason={allowed ? undefined : getUnavailableReason(token)}
            />
            {selected ? (
              <span className="material-symbols-outlined text-base text-primary">check</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="block" ref={wrapperRef}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center text-xs font-bold uppercase tracking-[0.22em] text-on-surface-variant">
          {label}
          {tooltip && <FieldTooltip content={tooltip} />}
        </span>
        {error ? <span className="text-xs font-bold text-error">{error}</span> : null}
      </div>

      <div className="relative">
        <button
          id={selectorId}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          disabled={interactiveDisabled}
          onClick={() => {
            if (!readOnly) setOpen((current) => !current);
          }}
          className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-left text-sm text-on-surface outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {selectedToken ? (
            <TokenDisplay
              token={selectedToken}
              balance={selectedBalance}
              balancesLoading={balancesLoading}
              showBalance={Boolean(balances)}
            />
          ) : (
            <span className="text-on-surface-variant">No tokens available</span>
          )}
          {!readOnly ? (
            <span className="material-symbols-outlined text-base text-on-surface-variant">
              expand_more
            </span>
          ) : null}
        </button>

        {/* Desktop dropdown */}
        {open && !readOnly && !isMobile ? (
          <div className="absolute z-30 mt-2 max-h-80 w-full overflow-auto rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-2 shadow-xl">
            {tokenList}
          </div>
        ) : null}
      </div>

      {/* Mobile bottom sheet */}
      {!readOnly ? (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-300"
            style={{
              opacity: isMobile && open ? 1 : 0,
              pointerEvents: isMobile && open ? 'auto' : 'none',
            }}
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] overflow-auto rounded-t-3xl bg-surface-container-lowest p-4 shadow-2xl transition-transform duration-300"
            style={{
              transform: isMobile && open ? 'translateY(0)' : 'translateY(100%)',
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-bold text-on-surface">{label}</span>
              <button
                type="button"
                aria-label="Close token selector"
                onClick={() => setOpen(false)}
                className="rounded-full p-1 hover:bg-surface-container"
              >
                <span className="material-symbols-outlined text-base text-on-surface-variant">
                  close
                </span>
              </button>
            </div>
            {tokenList}
          </div>
        </>
      ) : null}

      {hint ? <p className="mt-2 text-xs text-on-surface-variant">{hint}</p> : null}
      {selectedToken?.symbol === 'XLM' ? (
        <p className="mt-2 text-xs text-on-surface-variant" data-testid="xlm-token-selector-note">
          {getXlmPrecisionNote()}
        </p>
      ) : null}
    </div>
  );
}

function TokenDisplay({
  token,
  balance,
  balancesLoading,
  showBalance,
  unavailableReason,
}: {
  token: TokenLike;
  balance?: bigint;
  balancesLoading: boolean;
  showBalance: boolean;
  unavailableReason?: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <TokenIcon token={token} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-bold text-on-surface">{token.symbol}</span>
          <span className="text-xs text-on-surface-variant">{getTokenName(token)}</span>
        </span>
        {unavailableReason ? (
          <span className="block text-xs text-on-surface-variant">{unavailableReason}</span>
        ) : null}
        {showBalance ? (
          <span className="block text-xs text-on-surface-variant">
            {balancesLoading
              ? 'Loading balance...'
              : balance === undefined
                ? 'Balance unavailable'
                : `Balance: ${formatTokenAmount(balance, token)}`}
          </span>
        ) : null}
      </span>
    </span>
  );
}
