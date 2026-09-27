'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useWallet } from '@/context/WalletContext';
import { useToast } from '@/context/ToastContext';
import { useTransaction } from '@/hooks/useTransaction';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { getAllInvoices, Invoice, fundInvoice, submitSignedTransaction } from '@/utils/soroban';
import {
  formatAddress,
  formatDate,
  formatTokenAmount,
  calculateYield,
  tokenAmountToNumber,
} from '@/utils/format';
import { useApprovedTokens } from '@/hooks/useApprovedTokens';
import { usePayerScores } from '@/hooks/usePayerScores';
import RiskBadge from '@/components/RiskBadge';

export default function CompareInvoicesScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { address, connect } = useWallet();
  const { addToast } = useToast();
  const { execute, loading: txLoading, signingModal } = useTransaction();
  const { tokenMap, defaultToken } = useApprovedTokens();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [fundingInvoiceId, setFundingInvoiceId] = useState<string | null>(null);

  const ids = useMemo(() => {
    const idsParam = searchParams.get('ids');
    return idsParam ? idsParam.split(',').filter((id) => id.trim() !== '') : [];
  }, [searchParams]);

  useEffect(() => {
    async function fetchData() {
      if (ids.length === 0) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const all = await getAllInvoices();
        const filtered = all.filter((inv) => ids.includes(inv.id.toString()));
        setInvoices(filtered);
      } catch (error) {
        console.error('Failed to fetch invoices', error);
        addToast({
          type: 'error',
          title: 'Fetch Error',
          message: 'Failed to load invoices for comparison.',
        });
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [ids, addToast]);

  const { scores, risks } = usePayerScores(invoices);

  const stats = useMemo(() => {
    return invoices.map((inv) => {
      const now = Math.floor(Date.now() / 1000);
      const daysToDue = Math.max(0, Math.floor((Number(inv.due_date) - now) / 86400));
      const estYield = calculateYield(inv.amount, inv.discount_rate);
      const discountPercent = inv.discount_rate / 100;
      // APY = (yield / amount) * (365 / days) * 100
      const apy = daysToDue > 0 ? (discountPercent / 100) * (365 / daysToDue) * 100 : 0;
      const payerScore = scores.get(inv.payer);
      // The scores map holds full PayerScoreResult objects; unwrap the numeric
      // score here so sorting, display, and comparison all work on numbers.
      // (Previously an `as any` escape let the whole object leak into `score`.)
      const score = payerScore?.score ?? 0;

      const token = tokenMap.get(inv.token ?? defaultToken?.contractId ?? '') ?? defaultToken;

      return {
        id: inv.id.toString(),
        amount: tokenAmountToNumber(inv.amount, token ?? undefined),
        amountRaw: inv.amount,
        yield: Number(estYield) / Math.pow(10, token?.decimals ?? 7),
        yieldRaw: estYield,
        apy,
        discountRate: discountPercent,
        daysToDue,
        score,
        scoreDetail: payerScore ?? null,
        token: token?.symbol ?? 'USDC',
        payer: inv.payer,
        dueDate: inv.due_date,
        risk: risks.get(inv.payer) ?? 'Unknown',
        invoice: inv,
        tokenMetadata: token,
      };
    });
  }, [invoices, scores, risks, tokenMap, defaultToken]);

  const getBestValueIndex = (field: keyof (typeof stats)[0] | string, values: number[]) => {
    if (values.length === 0) return -1;

    if (field === 'daysToDue') {
      // Lower is better
      const min = Math.min(...values);
      return values.indexOf(min);
    }

    // Higher is better for yield, APY, discount, score, amount
    const max = Math.max(...values);
    return values.indexOf(max);
  };

  const handleFund = async (invoice: Invoice) => {
    if (!address) {
      await connect();
      return;
    }

    setFundingInvoiceId(invoice.id.toString());

    const result = await execute(
      async (signTx) => {
        const tx = await fundInvoice(address, invoice.id);
        return submitSignedTransaction({ tx, signTx });
      },
      {
        title: 'Funding Invoice...',
        pendingMessage: 'Waiting for wallet signature...',
        successTitle: 'Funded Successfully',
        successMessage: 'Invoice funded successfully.',
      }
    );

    setFundingInvoiceId(null);
    if (result) {
      router.push('/lp');
    }
  };

  const comparisonSummary = useMemo(() => {
    if (stats.length < 2) return '';

    const sortedByApy = [...stats].sort((a, b) => (b.apy || 0) - (a.apy || 0));
    const sortedByRisk = [...stats].sort((a, b) => (b.score || 0) - (a.score || 0));

    const bestApy = sortedByApy[0];
    const bestRisk = sortedByRisk[0];

    let summary = `${bestApy.token} Invoice #${
      bestApy.id
    } offers the highest APY at ${bestApy.apy.toFixed(2)}%.`;

    if (bestApy.id !== bestRisk.id) {
      summary += ` However, Invoice #${bestRisk.id} has a lower-risk profile with a payer score of ${bestRisk.score}.`;
    } else {
      summary += ` It also represents the best risk-adjusted return in this group.`;
    }

    return summary;
  }, [stats]);

  if (loading) {
    return (
      <main className="min-h-screen bg-background">
        <Navbar />
        {signingModal}
        <div className="pt-32 flex justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </main>
    );
  }

  if (ids.length === 0 || invoices.length === 0) {
    return (
      <main className="min-h-screen bg-background">
        <Navbar />
        {signingModal}
        <div className="pt-32 px-8 max-w-7xl mx-auto text-center">
          <h1 className="text-3xl font-bold serif mb-4">Comparison View</h1>
          <p className="text-on-surface-variant mb-8">No invoices selected for comparison.</p>
          <button
            onClick={() => router.push('/lp')}
            className="bg-primary text-white px-6 py-2 rounded-lg font-bold"
          >
            Back to Dashboard
          </button>
        </div>
      </main>
    );
  }

  type ComparisonStat = (typeof stats)[number];
  type ComparisonField = Extract<
    keyof ComparisonStat,
    'amount' | 'apy' | 'discountRate' | 'score' | 'yield' | 'daysToDue'
  >;

  const rows: Array<{
    label: string;
    field: ComparisonField | string;
    format?: (s: ComparisonStat) => React.ReactNode;
    noHighlight?: boolean;
  }> = [
    {
      label: 'Amount',
      field: 'amount',
      format: (s) => formatTokenAmount(s.amountRaw, s.tokenMetadata ?? undefined),
    },
    { label: 'Token', field: 'token', noHighlight: true },
    {
      label: 'Discount Rate',
      field: 'discountRate',
      format: (s) => `${s.discountRate.toFixed(2)}%`,
    },
    {
      label: 'Due Date',
      field: 'dueDate',
      format: (s) => formatDate(s.dueDate),
      noHighlight: true,
    },
    { label: 'Payer Score', field: 'score', format: (s) => s.score.toString() },
    {
      label: 'Risk Level',
      field: 'risk',
      format: (s) => <RiskBadge risk={s.risk} score={s.scoreDetail} />,
      noHighlight: true,
    },
    {
      label: 'Estimated Yield',
      field: 'yield',
      format: (s) => formatTokenAmount(s.yieldRaw, s.tokenMetadata ?? undefined),
    },
    { label: 'APY', field: 'apy', format: (s) => `${s.apy.toFixed(2)}%` },
    { label: 'Days to Maturity', field: 'daysToDue', format: (s) => `${s.daysToDue} days` },
    {
      label: 'Payer Address',
      field: 'payer',
      format: (s) => formatAddress(s.payer),
      noHighlight: true,
    },
  ];

  return (
    <main className="min-h-screen bg-background mb-20">
      <Navbar />
      {signingModal}
      <div className="pt-32 px-8 max-w-7xl mx-auto">
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold serif tracking-tight">Invoice Comparison</h1>
            <p className="text-on-surface-variant mt-2">
              Side-by-side analysis of selected opportunities.
            </p>
          </div>
          <button
            onClick={() => router.push('/lp')}
            className="flex items-center gap-2 text-primary font-bold hover:underline"
          >
            <span className="material-symbols-outlined">arrow_back</span>
            Back to Dashboard
          </button>
        </div>

        <div className="bg-surface-container-lowest rounded-3xl shadow-xl overflow-hidden border border-outline-variant/10">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="p-6 text-left bg-surface-container-low border-b border-surface-dim min-w-[200px]">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                      Feature
                    </span>
                  </th>
                  {stats.map((s) => (
                    <th
                      key={s.id}
                      className="p-6 text-center bg-surface-container-low border-b border-surface-dim"
                    >
                      <span className="text-xl font-bold text-primary block">Invoice #{s.id}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const values = row.noHighlight
                    ? []
                    : stats.map((s) => Number(s[row.field as ComparisonField]) || 0);
                  const bestIndex = row.noHighlight ? -1 : getBestValueIndex(row.field, values);

                  return (
                    <tr
                      key={row.label}
                      className="group border-b border-surface-dim/30 hover:bg-surface-container-low/20 transition-colors"
                    >
                      <td className="p-6 font-medium text-on-surface-variant bg-surface-container-low/10">
                        {row.label}
                      </td>
                      {stats.map((s, idx) => (
                        <td
                          key={s.id}
                          className={`p-6 text-center transition-all ${
                            idx === bestIndex ? 'bg-green-50/50' : ''
                          }`}
                        >
                          <div
                            className={`inline-block ${
                              idx === bestIndex ? 'text-green-700 font-bold' : ''
                            }`}
                          >
                            {row.format ? row.format(s) : String(s[row.field as ComparisonField])}
                            {idx === bestIndex && !row.noHighlight && (
                              <span className="block text-[9px] uppercase tracking-tighter mt-1 text-green-600">
                                Best Value
                              </span>
                            )}
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {/* Actions Row */}
                <tr className="bg-surface-container-low/5">
                  <td className="p-6"></td>
                  {stats.map((s) => (
                    <td key={s.id} className="p-8 text-center">
                      <button
                        onClick={() => handleFund(s.invoice)}
                        disabled={fundingInvoiceId === s.id || txLoading}
                        className="w-full bg-primary text-white py-3 rounded-xl font-bold shadow-md hover:bg-primary/90 disabled:opacity-50 transition-all active:scale-95"
                      >
                        {fundingInvoiceId === s.id ? 'Processing...' : `Fund #${s.id}`}
                      </button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {comparisonSummary && (
          <div className="mt-8 p-8 bg-surface-container-low rounded-3xl border border-primary-container/20">
            <h3 className="flex items-center gap-2 text-primary font-bold mb-3">
              <span className="material-symbols-outlined">insights</span>
              Comparative Insight
            </h3>
            <p className="text-lg text-on-surface leading-relaxed italic">
              &quot;{comparisonSummary}&quot;
            </p>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
