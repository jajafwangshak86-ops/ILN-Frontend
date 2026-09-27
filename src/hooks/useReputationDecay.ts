import { useState, useEffect } from 'react';
import { getReputation } from '@/utils/soroban';

// Mock governance decay parameters (since they aren't fully defined in governance.ts)
// 1 ledger ~ 5 seconds.
// Decay starts after 90 days of inactivity: (90 * 24 * 60 * 60) / 5 = 1,555,200 ledgers
const DECAY_THRESHOLD_LEDGERS = 1_555_200;
// Decay rate: 1 point per 30 days = 1 point per 518,400 ledgers
const DECAY_RATE_PER_LEDGER = 1 / 518_400;

export interface ReputationDecayStatus {
  isDecaying: boolean;
  projectedScore30Days: number;
  currentScore: number;
  loading: boolean;
}

export function useReputationDecay(
  address: string | undefined,
  currentLedger: number = 2_000_000 // In a real app, this would be fetched from the network
): ReputationDecayStatus {
  const [status, setStatus] = useState<ReputationDecayStatus>({
    isDecaying: false,
    projectedScore30Days: 100,
    currentScore: 100,
    loading: true,
  });

  useEffect(() => {
    if (!address) {
      setStatus((s) => ({ ...s, loading: false }));
      return;
    }

    let cancelled = false;
    setStatus((s) => ({ ...s, loading: true }));

    getReputation(address)
      .then((rep) => {
        if (cancelled || !rep) {
          setStatus((s) => ({ ...s, loading: false }));
          return;
        }

        const score = rep.score;
        // Using a fallback for last_activity_ledger if not present in the contract yet
        // For demonstration, let's say it's 100,000 ledgers ago, so not decaying unless we mock it older.
        // To ensure the UX can be tested, if last_activity_ledger is missing, we can simulate an older one or a recent one.
        // We will parse it from the reputation object once added.
        const lastActivity = rep.last_activity_ledger ?? 0;

        const ledgersSinceActive = Math.max(0, currentLedger - lastActivity);
        const isDecaying = ledgersSinceActive > DECAY_THRESHOLD_LEDGERS && lastActivity > 0;

        let projected = score;
        if (isDecaying || ledgersSinceActive + 518400 > DECAY_THRESHOLD_LEDGERS) {
          // Compute decay over next 30 days (518,400 ledgers)
          const ledgersIn30Days = 518400;
          const totalInactiveAfter30Days = ledgersSinceActive + ledgersIn30Days;

          let decayingLedgers = 0;
          if (isDecaying) {
            decayingLedgers = ledgersIn30Days;
          } else {
            // Will start decaying in the next 30 days
            decayingLedgers = totalInactiveAfter30Days - DECAY_THRESHOLD_LEDGERS;
          }

          const decayAmount = decayingLedgers * DECAY_RATE_PER_LEDGER;
          projected = Math.max(0, score - decayAmount);
        }

        setStatus({
          isDecaying,
          projectedScore30Days: projected,
          currentScore: score,
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) setStatus((s) => ({ ...s, loading: false }));
      });

    return () => {
      cancelled = true;
    };
  }, [address, currentLedger]);

  return status;
}
