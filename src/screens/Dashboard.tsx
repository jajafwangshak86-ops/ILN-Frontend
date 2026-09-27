'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
// eslint-disable-next-line no-restricted-imports -- Legacy dashboard query client exception
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import Footer from '@/components/Footer';
import Navbar from '@/components/Navbar';
import InvoiceQRModal from '@/components/InvoiceQRModal';
import InvoiceTimeline from '@/components/InvoiceTimeline';
import { CONTRACT_ID, NETWORK_NAME } from '@/constants';
import { useWallet } from '@/context/WalletContext';
import { useToast } from '@/context/ToastContext';
import { formatAddress, formatDate, formatUSDC, tokenAmountToNumber } from '@/utils/format';
import { type Invoice } from '@/utils/soroban';
import { useInvoices } from '@/hooks/queries';
import InvoiceStatusBadge from '@/components/InvoiceStatusBadge';
import LastUpdated from '@/components/LastUpdated';
import BulkActionBar from '../components/BulkActionBar';
import CancelInvoiceButton from '@/components/CancelInvoiceButton';
import SkeletonRow from '@/components/SkeletonRow';
import ErrorBoundary from '@/components/ErrorBoundary';
import PageHeader from '@/components/PageHeader';
import { useVisibleWindow } from '@/hooks/useVisibleWindow';

const STELLAR_EXPERT_CONTRACT_URL = `https://stellar.expert/explorer/${NETWORK_NAME.toLowerCase()}/contract/${CONTRACT_ID}`;

/**
 * Skeleton cell widths for the freelancer invoice table, matching its columns:
 * select · ID · Payer · Amount · Discount · Due Date · Status · Links.
 */
const DASHBOARD_INVOICE_COLUMNS = ['w-4', 'w-8', 'w-28', 'w-24', 'w-16', 'w-20', 'w-20', 'w-12'];

export type FreelancerStatusFilter =
  | 'All'
  | 'Pending'
  | 'Funded'
  | 'Paid'
  | 'Defaulted'
  | 'Cancelled';
export type FreelancerSortKey = 'amount' | 'due_date';
export type SortOrder = 'asc' | 'desc';
export type ViewMode = 'table' | 'timeline';

const TABLE_PAGE_SIZE = 50;

export function applyFreelancerFiltersAndSort(
  invoices: Invoice[],
  statusFilter: FreelancerStatusFilter,
  sortKey: FreelancerSortKey,
  sortOrder: SortOrder
): Invoice[] {
  const filtered =
    statusFilter === 'All'
      ? invoices
      : invoices.filter((invoice) => invoice.status === statusFilter);
  return [...filtered].sort((a, b) => {
    const aValue = a[sortKey];
    const bValue = b[sortKey];

    if (aValue < bValue) {
      return sortOrder === 'asc' ? -1 : 1;
    }
    if (aValue > bValue) {
      return sortOrder === 'asc' ? 1 : -1;
    }
    return 0;
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { address, connect, isConnected } = useWallet();
  const { data: allInvoices = [], isLoading: loading, dataUpdatedAt, refetch } = useInvoices();

  const [copiedPayer, setCopiedPayer] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FreelancerStatusFilter>('All');
  const [sortKey, setSortKey] = useState<FreelancerSortKey>('due_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [qrInvoice, setQrInvoice] = useState<Invoice | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Load view preference
  useEffect(() => {
    const saved = localStorage.getItem('freelancer_view_mode');
    if (saved === 'table' || saved === 'timeline') {
      setViewMode(saved as ViewMode);
    }
  }, []);

  // Save view preference
  const toggleViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('freelancer_view_mode', mode);
  };

  const myInvoices = useMemo(
    () => allInvoices.filter((invoice) => invoice.freelancer === address),
    [allInvoices, address]
  );

  const displayedInvoices = useMemo(
    () => applyFreelancerFiltersAndSort(myInvoices, statusFilter, sortKey, sortOrder),
    [myInvoices, statusFilter, sortKey, sortOrder]
  );

  // Only a bounded window of rows is mounted at a time so the table stays
  // responsive against large per-wallet invoice sets.
  const {
    hasMore: hasMoreRows,
    visibleSlice,
    loadMore,
    remaining,
  } = useVisibleWindow<Invoice>(
    displayedInvoices,
    TABLE_PAGE_SIZE,
    [statusFilter, sortKey, sortOrder],
    'freelancer-invoices-table'
  );
  const visibleInvoices = visibleSlice(displayedInvoices);

  const onSort = (nextSortKey: FreelancerSortKey) => {
    if (sortKey === nextSortKey) {
      setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextSortKey);
    setSortOrder('asc');
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const newSelected = new Set(selectedIds);
      let deselectedCount = 0;
      displayedInvoices.forEach((inv) => {
        if (inv.status === 'Pending') {
          newSelected.add(inv.id.toString());
        } else {
          deselectedCount++;
        }
      });
      setSelectedIds(newSelected);
      if (deselectedCount > 0) {
        addToast({
          type: 'error', // Changing this from info to error or success as a workaround since info might not exist
          title: 'Selection modified',
          message: `${deselectedCount} non-pending invoices were automatically skipped.`,
        });
      }
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleInvoiceSelection = (inv: Invoice) => {
    if (inv.status !== 'Pending') {
      addToast({
        type: 'error',
        title: 'Cannot select',
        message: 'Only Pending invoices can be selected for bulk cancellation.',
      });
      return;
    }

    const newSelected = new Set(selectedIds);
    if (newSelected.has(inv.id.toString())) {
      newSelected.delete(inv.id.toString());
    } else {
      newSelected.add(inv.id.toString());
    }
    setSelectedIds(newSelected);
  };

  const selectedInvoices = useMemo(
    () => myInvoices.filter((inv) => selectedIds.has(inv.id.toString())),
    [myInvoices, selectedIds]
  );

  const handleInvoiceCancelled = (cancelledInvoice: Invoice) => {
    queryClient.setQueryData<Invoice[]>(['invoices'], (current) =>
      current?.map((invoice) =>
        invoice.id === cancelledInvoice.id ? { ...invoice, status: 'Cancelled' } : invoice
      )
    );
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(cancelledInvoice.id.toString());
      return next;
    });
  };

  const isAllPendingSelected = useMemo(() => {
    const pendingInvoices = displayedInvoices.filter((inv) => inv.status === 'Pending');
    if (pendingInvoices.length === 0) return false;
    return pendingInvoices.every((inv) => selectedIds.has(inv.id.toString()));
  }, [displayedInvoices, selectedIds]);

  const _handleKeyDown = (
    e: React.KeyboardEvent<HTMLTableRowElement>,
    invoice: Invoice,
    index: number
  ) => {
    const rowElements = Array.from(
      e.currentTarget.parentElement?.querySelectorAll('tr[role="row"]') || []
    );

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        (rowElements[index + 1] as HTMLElement)?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        (rowElements[index - 1] as HTMLElement)?.focus();
        break;
      case 'Enter':
        e.preventDefault();
        router.push(`/i/${invoice.id.toString()}`);
        break;
      case 'c':
      case 'C':
        if (invoice.status === 'Pending') {
          e.preventDefault();
          addToast({
            type: 'success',
            title: 'Cancel Action',
            message: `Cancellation for invoice #${invoice.id.toString()} triggered via shortcut. Contract implementation pending.`,
          });
        }
        break;
    }
  };

  const copyPayerAddress = async (payer: string) => {
    try {
      await navigator.clipboard.writeText(payer);
      setCopiedPayer(payer);
      setTimeout(() => setCopiedPayer((current) => (current === payer ? null : current)), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <main className="min-h-screen">
      <Navbar />
      <section className="pt-32 pb-10 px-6 md:px-8 border-b border-outline-variant/10 bg-surface-container-lowest">
        <div className="max-w-7xl mx-auto">
          <PageHeader
            breadcrumbs={[{ label: 'Freelancer Dashboard' }]}
            title="My Submitted Invoices"
            description="Track every invoice you submitted, monitor statuses, and open the transaction context on Stellar Expert."
            actions={
              !isConnected ? (
                <button
                  onClick={connect}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white"
                >
                  Connect Wallet
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex p-1 bg-surface-container-low rounded-xl border border-outline-variant/30">
                    <button
                      onClick={() => toggleViewMode('table')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        viewMode === 'table'
                          ? 'bg-surface-container-highest text-primary shadow-sm'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm">table_rows</span>
                      Table
                    </button>
                    <button
                      onClick={() => toggleViewMode('timeline')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        viewMode === 'timeline'
                          ? 'bg-surface-container-highest text-primary shadow-sm'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm">timeline</span>
                      Timeline
                    </button>
                  </div>

                  <button
                    onClick={() => void refetch()}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl border border-outline-variant/30 px-4 py-2.5 text-sm font-medium text-on-surface-variant disabled:opacity-50"
                  >
                    Refresh
                  </button>
                </div>
              )
            }
          />
        </div>
      </section>

      <section className="px-6 md:px-8 py-6">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-6">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="status-filter"
                  className="text-sm font-medium text-on-surface-variant"
                >
                  Status
                </label>
                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as FreelancerStatusFilter)
                  }
                  className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm"
                >
                  <option value="All">All</option>
                  <option value="Pending">Pending</option>
                  <option value="Funded">Funded</option>
                  <option value="Paid">Paid</option>
                  <option value="Defaulted">Defaulted</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>
              <p className="text-xs text-on-surface-variant">Auto-refreshes active invoices.</p>
            </div>
          </div>

          <ErrorBoundary onRetry={() => void refetch()}>
            {viewMode === 'table' ? (
              <div className="overflow-x-auto rounded-2xl border border-outline-variant/10 bg-surface-container-lowest">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low">
                    <tr>
                      <th className="px-4 py-4 pl-6 w-12">
                        <input
                          type="checkbox"
                          checked={isAllPendingSelected}
                          onChange={handleSelectAll}
                          disabled={
                            displayedInvoices.filter((i) => i.status === 'Pending').length === 0
                          }
                          className="w-4 h-4 rounded border-outline-variant/50 text-primary focus:ring-primary/40 bg-surface cursor-pointer"
                          title="Select all Pending invoices"
                        />
                      </th>
                      <th className="px-2 md:px-4 py-4 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                        ID
                      </th>
                      <th className="px-4 md:px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                        Payer
                      </th>
                      <th
                        className="px-4 md:px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant cursor-pointer"
                        onClick={() => onSort('amount')}
                      >
                        Amount {sortKey === 'amount' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="px-4 md:px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                        Discount
                      </th>
                      <th
                        className="px-4 md:px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant cursor-pointer"
                        onClick={() => onSort('due_date')}
                      >
                        Due Date {sortKey === 'due_date' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="px-4 md:px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                        Status
                      </th>
                      <th className="px-4 md:px-6 py-4 pr-6 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                        Links
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {!isConnected ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-14 text-center text-on-surface-variant">
                          Connect your wallet to view submitted invoices.
                        </td>
                      </tr>
                    ) : loading && myInvoices.length === 0 ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <SkeletonRow key={i} columns={DASHBOARD_INVOICE_COLUMNS} />
                      ))
                    ) : displayedInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-14 text-center text-on-surface-variant">
                          No invoices found for this wallet.
                        </td>
                      </tr>
                    ) : (
                      visibleInvoices.map((invoice) => (
                        <tr
                          key={invoice.id.toString()}
                          className={`transition-colors ${
                            selectedIds.has(invoice.id.toString())
                              ? 'bg-primary/5'
                              : 'hover:bg-surface-container-low'
                          }`}
                        >
                          <td className="px-4 py-5 pl-6">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(invoice.id.toString())}
                              onChange={() => toggleInvoiceSelection(invoice)}
                              disabled={invoice.status !== 'Pending'}
                              className="w-4 h-4 rounded border-outline-variant/50 text-primary focus:ring-primary/40 bg-surface cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            />
                          </td>
                          <td className="px-2 md:px-4 py-5 font-bold text-primary">
                            #{invoice.id.toString()}
                          </td>
                          <td className="px-4 md:px-6 py-5">
                            <div className="inline-flex items-center gap-2">
                              <Link
                                href={`/profile/${invoice.payer}`}
                                className="font-mono text-sm text-primary hover:underline"
                              >
                                {formatAddress(invoice.payer)}
                              </Link>
                              <button
                                onClick={() => void copyPayerAddress(invoice.payer)}
                                className="rounded border border-outline-variant/30 px-2 py-1 text-[10px] font-bold uppercase text-on-surface-variant"
                              >
                                {copiedPayer === invoice.payer ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          </td>
                          <td className="px-4 md:px-6 py-5 font-bold">
                            {formatUSDC(invoice.amount)}
                          </td>
                          <td className="px-4 md:px-6 py-5">
                            {(invoice.discount_rate / 100).toFixed(2)}%
                          </td>
                          <td className="px-4 md:px-6 py-5">{formatDate(invoice.due_date)}</td>
                          <td className="px-4 md:px-6 py-5">
                            <InvoiceStatusBadge status={invoice.status} />
                          </td>
                          <td className="px-4 md:px-6 py-5">
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col gap-1 flex-1">
                                <Link
                                  className="text-xs font-medium text-primary hover:underline"
                                  href={`/i/${invoice.id.toString()}`}
                                >
                                  Public invoice page
                                </Link>
                                <a
                                  className="text-xs font-medium text-primary hover:underline"
                                  href={STELLAR_EXPERT_CONTRACT_URL}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Stellar Expert
                                </a>
                              </div>

                              {/* Row Action Menu */}
                              <div className="relative group">
                                <button
                                  className="p-1 rounded-full hover:bg-surface-container-high transition-colors"
                                  aria-label="More actions"
                                >
                                  <span className="material-symbols-outlined text-lg text-on-surface-variant">
                                    more_vert
                                  </span>
                                </button>
                                <div className="absolute right-0 bottom-full mb-2 hidden group-focus-within:block group-hover:block bg-surface-container-high border border-outline-variant/30 rounded-xl shadow-xl z-10 py-1 min-w-[160px]">
                                  <Link
                                    href={{
                                      pathname: '/submit',
                                      query: {
                                        prefill_id: invoice.id.toString(),
                                        payer: invoice.payer,
                                        amount: tokenAmountToNumber(invoice.amount).toString(),
                                        discount: (invoice.discount_rate / 100).toString(),
                                        token: invoice.token || '',
                                      },
                                    }}
                                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-on-surface hover:bg-surface-container-highest transition-colors w-full text-left"
                                  >
                                    <span className="material-symbols-outlined text-[18px]">
                                      content_copy
                                    </span>
                                    Submit similar
                                  </Link>
                                  <button
                                    onClick={() => setQrInvoice(invoice)}
                                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-on-surface hover:bg-surface-container-highest transition-colors w-full text-left"
                                  >
                                    <span className="material-symbols-outlined text-[18px]">
                                      qr_code
                                    </span>
                                    Show QR code
                                  </button>
                                  <CancelInvoiceButton
                                    invoice={invoice}
                                    walletAddress={address}
                                    onCancelled={handleInvoiceCancelled}
                                    compact
                                  />
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-outline-variant/10 bg-surface-container-low/30 px-4 py-3">
                  {hasMoreRows ? (
                    <button
                      type="button"
                      onClick={loadMore}
                      className="rounded-lg border border-outline-variant/30 px-4 py-2 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-container-high"
                    >
                      Load more ({remaining} remaining)
                    </button>
                  ) : (
                    <span className="hidden sm:block" aria-hidden />
                  )}
                  <LastUpdated updatedAt={dataUpdatedAt} />
                </div>
              </div>
            ) : (
              <InvoiceTimeline invoices={displayedInvoices} loading={loading} />
            )}
          </ErrorBoundary>
        </div>
      </section>

      <BulkActionBar
        selectedInvoices={selectedInvoices}
        onClearSelection={() => setSelectedIds(new Set())}
        onRefresh={() => {
          void refetch();
        }}
      />

      <Footer />

      {/* QR Code modal — opened from row action menu */}
      {qrInvoice && (
        <InvoiceQRModal
          invoiceId={qrInvoice.id}
          amount={qrInvoice.amount}
          dueDate={qrInvoice.due_date}
          freelancer={qrInvoice.freelancer}
          onClose={() => setQrInvoice(null)}
        />
      )}
    </main>
  );
}
