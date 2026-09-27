'use client';

import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ReputationEventType,
  ReputationRange,
  ReputationHistoryPoint,
  ReputationUpdatedEvent,
  buildReputationHistory,
  hasEnoughReputationHistory,
} from '@/utils/reputation-history';

const RANGES: Array<{ value: ReputationRange; label: string }> = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

const EVENT_COLORS: Record<ReputationEventType, string> = {
  paid: '#22c55e',
  defaulted: '#ef4444',
  decay: '#f97316',
};

const EVENT_LABELS: Record<ReputationEventType, string> = {
  paid: 'Payment received',
  defaulted: 'Invoice defaulted',
  decay: 'Score decay',
};

function AnnotationDot(props: {
  cx?: number;
  cy?: number;
  payload?: ReputationHistoryPoint;
  showAnnotations?: boolean;
}) {
  const { cx, cy, payload, showAnnotations } = props;
  if (cx === undefined || cy === undefined || !payload) return null;

  if (!showAnnotations) {
    return <circle cx={cx} cy={cy} r={4} fill="var(--color-primary, #3d627f)" />;
  }

  const color = EVENT_COLORS[payload.eventType] ?? 'var(--color-primary, #3d627f)';
  return <circle cx={cx} cy={cy} r={6} fill={color} stroke="white" strokeWidth={1.5} />;
}

export default function ReputationHistoryChart({ events }: { events: ReputationUpdatedEvent[] }) {
  const [range, setRange] = useState<ReputationRange>('90d');
  const [showAnnotations, setShowAnnotations] = useState(true);
  const points = useMemo(() => buildReputationHistory(events, range), [events, range]);

  return (
    <section className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-6">
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-xl font-semibold">Reputation history</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            ReputationUpdated events over time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((option) => (
            <button
              key={option.value}
              onClick={() => setRange(option.value)}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${
                range === option.value
                  ? 'bg-primary text-white'
                  : 'bg-surface-container text-on-surface-variant'
              }`}
            >
              {option.label}
            </button>
          ))}
          <button
            onClick={() => setShowAnnotations((v) => !v)}
            aria-pressed={showAnnotations}
            className={`rounded-lg px-3 py-2 text-xs font-bold ${
              showAnnotations
                ? 'bg-secondary-container text-on-surface'
                : 'bg-surface-container text-on-surface-variant'
            }`}
          >
            {showAnnotations ? 'Hide annotations' : 'Show annotations'}
          </button>
        </div>
      </div>

      {showAnnotations && (
        <div className="mb-4 flex flex-wrap gap-4">
          {(Object.entries(EVENT_COLORS) as [ReputationEventType, string][]).map(
            ([type, color]) => (
              <span
                key={type}
                className="flex items-center gap-1.5 text-xs text-on-surface-variant"
              >
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {EVENT_LABELS[type]}
              </span>
            )
          )}
        </div>
      )}

      {!hasEnoughReputationHistory(points) ? (
        <div className="flex min-h-72 items-center justify-center rounded-xl bg-surface-container text-sm text-on-surface-variant">
          No history available
        </div>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ left: 8, right: 18, top: 12, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={
                  // as-any justification: recharts v2 `Tooltip` formatter prop
                  // types do not cover our tuple-returning custom formatter that
                  // reads `item.payload.eventType`. Cast is confined to this prop.
                  // See https://github.com/recharts/recharts/issues (Tooltip formatter typing).
                  ((value: any, _name: any, item: any) => {
                    const eventType = item.payload?.eventType as ReputationEventType;
                    const eventLabel = EVENT_LABELS[eventType] ?? eventType;
                    return [`${value}/100`, eventLabel];
                  }) as any
                }
                labelFormatter={
                  // as-any justification: recharts v2 `labelFormatter` types do
                  // not expose the tooltip payload items we read for the ledger
                  // timestamp. Cast is confined to this prop.
                  // See https://github.com/recharts/recharts/issues (Tooltip labelFormatter typing).
                  ((label: any, items: any) => {
                    const payload = items?.[0]?.payload as ReputationHistoryPoint | undefined;
                    if (!payload) return label;
                    const date = new Date(payload.timestamp * 1000).toLocaleString();
                    return payload.ledger ? `${label} · ${date}` : date;
                  }) as any
                }
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke="var(--color-primary, #3d627f)"
                strokeWidth={3}
                dot={(props) => (
                  <AnnotationDot
                    key={`dot-${props.index}`}
                    cx={props.cx}
                    cy={props.cy}
                    payload={props.payload as ReputationHistoryPoint}
                    showAnnotations={showAnnotations}
                  />
                )}
                activeDot={{ r: 7 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
