'use client';

import { useState, useMemo, useCallback } from 'react';
import { useWallet } from '@/context/WalletContext';
import { useInvoices } from '@/hooks/queries';
import { useApprovedTokens } from '@/hooks/useApprovedTokens';
import { usePayerScores } from '@/hooks/usePayerScores';
import { Invoice } from '@/utils/soroban';
import { calculateYield, formatTokenAmount, formatAddress, formatDate } from '@/utils/format';
import { RiskLevel } from '@/utils/risk';
import Navbar from '@/components/Navbar';
import InvoiceMarketplaceCard from '@/components/InvoiceMarketplaceCard';
import FundConfirmModal from '@/components/FundConfirmModal';
import LPSettingsModal from '@/components/LPSettingsModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import PageHeader from '@/components/PageHeader';
import { useLPSettings } from '@/hooks/useLPSettings';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { useBookmarks } from '@/hooks/useBookmarks';
const PAGE_SIZE = 20;

type SortKey = 'yield' | 'amount' | 'due_date';

export default function MarketplacePage() {
  useDocumentTitle({ pageTitle: 'Invoice Marketplace' });
  const { isConnected } = useWallet();
  const { data: allInvoices = [], isLoading: loading, refetch } = useInvoices();
  const { tokenMap, defaultToken } = useApprovedTokens();

  const [sortKey, setSortKey] = useState<SortKey>('yield');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Advanced Filters
  const [filterTokens, setFilterTokens] = useState<string[]>([]);
  const [filterRisks, setFilterRisks] = useState<RiskLevel[]>([]);
  const [filterMinDiscount, setFilterMinDiscount] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterMinYield, setFilterMinYield] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');

  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [filterBookmarked, setFilterBookmarked] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const { settings } = useLPSettings();
  const { isBookmarked, toggleBookmark, count: bookmarkCount, atLimit } = useBookmarks();

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  }, []);

  const compareInvoices = useMemo(
    () => allInvoices.filter((inv) => compareIds.includes(inv.id.toString())),
    [allInvoices, compareIds]
  );

  // Filter to Pending only
  const pendingInvoices = useMemo(
    () => allInvoices.filter((inv) => inv.status === 'Pending'),
    [allInvoices]
  );

  // Fetch payer scores and risk levels
  const { scores: payerScores, risks: payerRisks } = usePayerScores(pendingInvoices);

  // Apply filters
  const filtered = useMemo(() => {
    let result = pendingInvoices;

    if (filterTokens.length > 0) {
      result = result.filter((inv) => {
        const sym = (tokenMap.get(inv.token ?? '')?.symbol ?? 'USDC').toUpperCase();
        return filterTokens.includes(sym);
      });
    }

    const minYield = filterMinYield ? Number(filterMinYield) : null;
    if (minYield !== null && Number.isFinite(minYield)) {
      result = result.filter((inv) => {
        const y =
          (Number(calculateYield(inv.amount, inv.discount_rate)) / Number(inv.amount)) * 100;
        return y >= minYield;
      });
    }

    const maxAmt = filterMaxAmount ? Number(filterMaxAmount) : null;
    if (maxAmt !== null && Number.isFinite(maxAmt)) {
      result = result.filter((inv) => Number(inv.amount) / 1e6 <= maxAmt);
    }

    if (filterRisks.length > 0) {
      result = result.filter((inv) => {
        const risk = payerRisks.get(inv.payer) ?? 'Unknown';
        return filterRisks.includes(risk);
      });
    }

    if (filterMinDiscount) {
      const minDiscBps = Number(filterMinDiscount) * 100;
      result = result.filter((inv) => Number(inv.discount_rate) >= minDiscBps);
    }

    if (filterStartDate) {
      const start = new Date(filterStartDate).getTime();
      result = result.filter((inv) => Number(inv.due_date) * 1000 >= start);
    }

    if (filterEndDate) {
      const end = new Date(filterEndDate).getTime() + 86400000; // include end of day
      result = result.filter((inv) => Number(inv.due_date) * 1000 <= end);
    }

    if (filterBookmarked) {
      result = result.filter((inv) => isBookmarked(inv.id.toString()));
    }

    return result;
  }, [
    pendingInvoices,
    filterTokens,
    filterMinYield,
    filterMaxAmount,
    filterRisks,
    filterMinDiscount,
    filterStartDate,
    filterEndDate,
    tokenMap,
    payerRisks,
    filterBookmarked,
    isBookmarked,
  ]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'yield') {
        const ya = Number(calculateYield(a.amount, a.discount_rate));
        const yb = Number(calculateYield(b.amount, b.discount_rate));
        cmp = ya - yb;
      } else if (sortKey === 'amount') {
        cmp = Number(a.amount - b.amount);
      } else {
        cmp = Number(a.due_date - b.due_date);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortOrder]);

  // Paginate
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const activeFilterCount =
    (filterTokens.length > 0 ? 1 : 0) +
    (filterMinYield ? 1 : 0) +
    (filterMaxAmount ? 1 : 0) +
    (filterRisks.length > 0 ? 1 : 0) +
    (Number(filterMinDiscount) > 0 ? 1 : 0) +
    (filterStartDate || filterEndDate ? 1 : 0);

  const clearAllFilters = () => {
    setFilterTokens([]);
    setFilterMinYield('');
    setFilterMaxAmount('');
    setFilterRisks([]);
    setFilterMinDiscount('');
    setFilterStartDate('');
    setFilterEndDate('');
    setPage(1);
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface-container-lowest">
      <Navbar />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <PageHeader
            title="Invoice Marketplace"
            description="Browse pending invoices available for funding. Filter, sort, and fund invoices directly."
            actions={
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant/30 hover:bg-surface-variant/20 transition-colors text-sm font-bold"
              >
                <span className="material-symbols-outlined text-sm">settings</span>
                Risk Settings
              </button>
            }
          />
        </div>

        {/* Filters Toggle & Sort */}
        <div className="flex flex-col gap-3 mb-6 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFiltersOpen((o) => !o)}
              className="inline-flex items-center gap-2 rounded-xl border border-outline-variant/30 px-4 py-2 text-sm font-medium text-on-surface-variant hover:border-primary/40 hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">filter_list</span>
              Filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {activeFilterCount > 0 && (
              <button
                onClick={clearAllFilters}
                className="text-xs font-bold uppercase tracking-wide text-primary hover:underline px-2 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Clear All Filters
              </button>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-on-surface-variant">Saved</label>
            <button
              onClick={() => {
                setFilterBookmarked((v) => !v);
                setPage(1);
              }}
              title={atLimit ? 'Bookmark limit (100) reached' : undefined}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                filterBookmarked
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-outline-variant/30 text-on-surface-variant hover:border-primary/40'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">
                {filterBookmarked ? 'bookmark' : 'bookmark_border'}
              </span>
              Bookmarked{bookmarkCount > 0 ? ` (${bookmarkCount})` : ''}
            </button>
          </div>
          {compareIds.length >= 2 && (
            <button
              onClick={() => setShowCompareModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-primary bg-primary/10 text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">compare_arrows</span>
              Compare ({compareIds.length})
            </button>
          )}
          {compareIds.length > 0 && compareIds.length < 2 && (
            <span className="text-xs text-on-surface-variant self-center">
              Select {2 - compareIds.length} more to compare
            </span>
          )}
          <div className="flex gap-2 ml-auto">
            {(['yield', 'amount', 'due_date'] as SortKey[]).map((key) => (
              <button
                key={key}
                onClick={() => toggleSort(key)}
                className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                  sortKey === key
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-outline-variant/30 text-on-surface-variant hover:border-primary/40'
                }`}
              >
                {key === 'yield' ? 'Yield' : key === 'amount' ? 'Amount' : 'Due Date'}
                {sortKey === key && (sortOrder === 'desc' ? ' ↓' : ' ↑')}
              </button>
            ))}
          </div>
        </div>

        {/* Advanced Filters Panel */}
        {isFiltersOpen && (
          <div className="mb-6 rounded-xl border border-outline-variant/20 bg-surface-container-low p-5 shadow-sm">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {/* Token Type */}
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Token
                </p>
                <div className="flex flex-col gap-2">
                  {['USDC', 'EURC', 'XLM'].map((token) => (
                    <label
                      key={token}
                      className="inline-flex items-center gap-2 text-sm text-on-surface cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={filterTokens.includes(token)}
                        onChange={(e) => {
                          if (e.target.checked) setFilterTokens((prev) => [...prev, token]);
                          else setFilterTokens((prev) => prev.filter((t) => t !== token));
                          setPage(1);
                        }}
                        className="rounded border-outline-variant/50 text-primary focus:ring-primary/40"
                      />
                      <span>{token}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Risk Level */}
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Risk Level
                </p>
                <div className="flex flex-col gap-2">
                  {(['Low', 'Medium', 'High'] as RiskLevel[]).map((risk) => (
                    <label
                      key={risk}
                      className="inline-flex items-center gap-2 text-sm text-on-surface cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={filterRisks.includes(risk)}
                        onChange={(e) => {
                          if (e.target.checked) setFilterRisks((prev) => [...prev, risk]);
                          else setFilterRisks((prev) => prev.filter((r) => r !== risk));
                          setPage(1);
                        }}
                        className="rounded border-outline-variant/50 text-primary focus:ring-primary/40"
                      />
                      <span>{risk}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Discount & Yield */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Min Discount (%)
                  </p>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={filterMinDiscount || '0'}
                    onChange={(e) => {
                      setFilterMinDiscount(e.target.value);
                      setPage(1);
                    }}
                    className="w-full h-2 bg-surface-container-high rounded-lg appearance-none cursor-pointer slider"
                  />
                  <div className="flex justify-between text-xs text-on-surface-variant">
                    <span>0%</span>
                    <span className="font-semibold text-on-surface">
                      {filterMinDiscount || '0'}%
                    </span>
                    <span>100%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Min Yield %
                  </p>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={filterMinYield}
                    placeholder="e.g. 2.0"
                    onChange={(e) => {
                      setFilterMinYield(e.target.value);
                      setPage(1);
                    }}
                    className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm w-full"
                  />
                </div>
              </div>

              {/* Due Date & Amount */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Due Date Range
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={filterStartDate}
                      onChange={(e) => {
                        setFilterStartDate(e.target.value);
                        setPage(1);
                      }}
                      className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm w-full"
                      aria-label="Start Date"
                    />
                    <input
                      type="date"
                      value={filterEndDate}
                      onChange={(e) => {
                        setFilterEndDate(e.target.value);
                        setPage(1);
                      }}
                      className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm w-full"
                      aria-label="End Date"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Max Amount (USDC)
                  </p>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={filterMaxAmount}
                    placeholder="e.g. 10000"
                    onChange={(e) => {
                      setFilterMaxAmount(e.target.value);
                      setPage(1);
                    }}
                    className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results count */}
        <p className="text-sm text-on-surface-variant mb-4">
          {sorted.length} invoice{sorted.length !== 1 ? 's' : ''} available
        </p>

        <ErrorBoundary onRetry={() => void refetch()}>
          {loading && paginated.length === 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 animate-pulse"
                >
                  <div className="h-5 w-20 bg-surface-variant rounded mb-3" />
                  <div className="space-y-2">
                    <div className="h-4 bg-surface-variant rounded" />
                    <div className="h-4 bg-surface-variant rounded w-3/4" />
                    <div className="h-4 bg-surface-variant rounded w-1/2" />
                  </div>
                  <div className="h-10 bg-surface-variant rounded mt-4" />
                </div>
              ))}
            </div>
          ) : paginated.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <span className="material-symbols-outlined text-5xl text-on-surface-variant/30 mb-4">
                receipt_long
              </span>
              <p className="font-medium text-on-surface">No Pending Invoices</p>
              <p className="mt-1 text-sm text-on-surface-variant">
                There are currently no invoices matching your filters.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {paginated.map((invoice) => (
                <InvoiceMarketplaceCard
                  key={invoice.id.toString()}
                  invoice={invoice}
                  tokenMap={tokenMap}
                  defaultToken={defaultToken}
                  payerScore={payerScores.get(invoice.payer) ?? null}
                  payerRisk={payerRisks.get(invoice.payer) ?? 'Unknown'}
                  onFund={setSelectedInvoice}
                  isWalletConnected={isConnected}
                  minReputation={settings.minReputation}
                  isBookmarked={isBookmarked(invoice.id.toString())}
                  onBookmark={toggleBookmark}
                  isCompareMode={compareIds.length > 0}
                  isSelected={compareIds.includes(invoice.id.toString())}
                  onToggleCompare={toggleCompare}
                />
              ))}
            </div>
          )}
        </ErrorBoundary>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 rounded-lg text-sm font-bold border border-outline-variant/30 disabled:opacity-40 hover:bg-surface-variant/20"
            >
              Previous
            </button>
            <span className="text-sm text-on-surface-variant px-3">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-2 rounded-lg text-sm font-bold border border-outline-variant/30 disabled:opacity-40 hover:bg-surface-variant/20"
            >
              Next
            </button>
          </div>
        )}
      </main>

      {/* Fund Modal */}
      <FundConfirmModal
        invoice={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        onSuccess={() => setSelectedInvoice(null)}
      />

      <LPSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Compare Modal */}
      {showCompareModal && compareInvoices.length >= 2 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setShowCompareModal(false)}
        >
          <div
            className="bg-surface-container-lowest rounded-3xl shadow-2xl border border-outline-variant/20 w-full max-w-5xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between p-6 border-b border-outline-variant/15 bg-surface-container-lowest">
              <h2 className="text-xl font-bold">Compare Invoices</h2>
              <button
                onClick={() => setShowCompareModal(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-variant transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="p-4 text-left text-[11px] font-bold uppercase tracking-widest text-on-surface-variant bg-surface-container-low/50 min-w-[160px]">
                      Field
                    </th>
                    {compareInvoices.map((inv) => (
                      <th
                        key={inv.id.toString()}
                        className="p-4 text-center bg-surface-container-low/50 border-l border-outline-variant/10"
                      >
                        <span className="text-lg font-bold text-primary">
                          Invoice #{inv.id.toString()}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      {
                        label: 'Token',
                        get: (inv: Invoice) =>
                          tokenMap.get(inv.token ?? defaultToken?.contractId ?? '')?.symbol ??
                          'USDC',
                      },
                      {
                        label: 'Amount',
                        get: (inv: Invoice) =>
                          formatTokenAmount(
                            inv.amount,
                            defaultToken ??
                              tokenMap.get(inv.token ?? '') ?? {
                                contractId: '',
                                name: 'USD Coin',
                                symbol: 'USDC',
                                decimals: 7,
                                iconLabel: 'US',
                                logo: '/tokens/usdc.svg',
                                isAllowed: true,
                              }
                          ),
                      },
                      {
                        label: 'Discount',
                        get: (inv: Invoice) => `${(inv.discount_rate / 100).toFixed(2)}%`,
                      },
                      {
                        label: 'Effective Yield',
                        get: (inv: Invoice) =>
                          `${(
                            (Number(calculateYield(inv.amount, inv.discount_rate)) /
                              Number(inv.amount)) *
                            100
                          ).toFixed(2)}%`,
                      },
                      { label: 'Due Date', get: (inv: Invoice) => formatDate(inv.due_date) },
                      { label: 'Submitter', get: (inv: Invoice) => formatAddress(inv.freelancer) },
                      { label: 'Payer', get: (inv: Invoice) => formatAddress(inv.payer) },
                      {
                        label: 'Risk',
                        get: (inv: Invoice) => payerRisks.get(inv.payer) ?? 'Unknown',
                      },
                      {
                        label: 'Payer Score',
                        get: (inv: Invoice) => (payerScores.get(inv.payer)?.score ?? 0).toString(),
                      },
                    ] as const
                  ).map((row) => {
                    const values = compareInvoices.map(row.get);
                    const isNumeric = values.every((v) => !isNaN(Number(v)));
                    const bestValue = isNumeric ? Math.max(...values.map(Number)) : null;
                    return (
                      <tr
                        key={row.label}
                        className="border-b border-outline-variant/10 hover:bg-surface-container-low/20 transition-colors"
                      >
                        <td className="p-4 font-medium text-on-surface-variant text-sm">
                          {row.label}
                        </td>
                        {values.map((val, idx) => {
                          const isBest =
                            isNumeric && bestValue !== null && Number(val) === bestValue;
                          return (
                            <td
                              key={compareInvoices[idx].id.toString()}
                              className={`p-4 text-center text-sm border-l border-outline-variant/10 ${
                                isBest ? 'bg-green-50/50 font-bold text-green-700' : ''
                              }`}
                            >
                              {val}
                              {isBest && (
                                <span className="block text-[9px] uppercase tracking-tighter mt-0.5 text-green-600">
                                  Best
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
