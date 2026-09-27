'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  isConnected,
  getAddress,
  setAllowed,
  signTransaction,
  getNetwork,
  requestAccess,
} from '@stellar/freighter-api';
import { NETWORK_NAME, NETWORK_PASSPHRASE } from '@/constants';
import {
  normalizeWalletNetwork,
  getMismatchDetails,
  getConfiguredStellarNetwork,
  type MismatchDetails,
} from '@/utils/network';
import { getWalletRoles, type WalletRole } from '@/utils/soroban';
import { trackEvent } from '@/lib/analytics';
import {
  clearWalletStorage,
  getStoredWalletProvider,
  setStoredWalletProvider,
  WALLET_ADDRESS_STORAGE_KEY,
  type WalletProviderType,
} from '@/utils/walletStorage';
import {
  connectWalletConnect,
  disconnectWalletConnect,
  getWalletConnectAddress,
  signTransactionWithWalletConnect,
} from '@/lib/walletConnect';
import WalletSelectionModal from '@/components/WalletSelectionModal';
import { useToast } from './ToastContext';

type WalletProviderName = WalletProviderType;

interface FreighterExtension {
  setNetwork?: (network: string) => Promise<void>;
}

interface FreighterWindow extends Window {
  stellar?: { freighter?: FreighterExtension };
  freighter?: FreighterExtension;
}

export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_WARNING_BEFORE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export interface WalletProviderProps {
  children: React.ReactNode;
  idleTimeoutMs?: number;
  idleWarningMs?: number;
}

interface WalletContextType {
  address: string | null;
  isConnected: boolean;
  isInstalled: boolean;
  isReconnecting: boolean;
  preferredWalletProvider: WalletProviderName | null;
  error: string | null;
  networkMismatch: boolean;
  rpcMismatch: boolean;
  mismatchDetails: MismatchDetails | null;
  switchingNetwork: boolean;
  walletNetwork: string | null;
  roles: WalletRole[];
  rolesLoading: boolean;
  connect: () => Promise<void>;
  connectWalletConnect: (customAddress?: string) => Promise<void>;
  disconnect: () => void;
  signTx: (txXdr: string) => Promise<string>;
  switchNetwork: () => Promise<void>;
  resetIdleTimer: () => void;
}

export const WalletContext = createContext<WalletContextType | undefined>(undefined);

const STORAGE_KEY = WALLET_ADDRESS_STORAGE_KEY;

function extractConnectionState(result: unknown): boolean {
  if (typeof result === 'boolean') {
    return result;
  }

  if (result && typeof result === 'object' && 'isConnected' in result) {
    return Boolean((result as { isConnected?: unknown }).isConnected);
  }

  return false;
}

function extractNetworkName(result: unknown): string | null {
  if (typeof result === 'string') {
    return result;
  }

  if (result && typeof result === 'object' && 'network' in result) {
    const network = (result as { network?: unknown }).network;
    return typeof network === 'string' ? network : null;
  }

  return null;
}

function extractAllowedState(result: unknown): boolean {
  if (typeof result === 'boolean') {
    return result;
  }

  if (result && typeof result === 'object' && 'isAllowed' in result) {
    return Boolean((result as { isAllowed?: unknown }).isAllowed);
  }

  return false;
}

export const WalletProvider: React.FC<WalletProviderProps> = ({
  children,
  idleTimeoutMs,
  idleWarningMs,
}) => {
  const { addToast, updateToast, removeToast } = useToast();
  const router = useRouter();
  const [address, setAddress] = useState<string | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [networkMismatch, setNetworkMismatch] = useState(false);
  const [rpcMismatch, setRpcMismatch] = useState(false);
  const [mismatchDetails, setMismatchDetails] = useState<MismatchDetails | null>(null);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [walletNetwork, setWalletNetwork] = useState<string | null>(null);
  const [roles, setRoles] = useState<WalletRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  // Which provider to connect with is chosen in the selection modal (#2).
  const [isSelectingProvider, setIsSelectingProvider] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<WalletProviderName | null>(null);
  const [openWalletConnectByDefault, setOpenWalletConnectByDefault] = useState(false);

  const checkNetwork = useCallback(async () => {
    try {
      const network = extractNetworkName(await getNetwork());
      if (!network) {
        setWalletNetwork(null);
        setNetworkMismatch(false);
        setRpcMismatch(false);
        setMismatchDetails(null);
        return true;
      }
      setWalletNetwork(network);

      const details = getMismatchDetails(network);
      setMismatchDetails(details);
      setNetworkMismatch(details.walletMismatch);
      setRpcMismatch(details.rpcMismatch);

      return !details.walletMismatch;
    } catch (e) {
      console.error('Failed to get network', e);
      setWalletNetwork(null);
      setNetworkMismatch(false);
      setRpcMismatch(false);
      setMismatchDetails(null);
      return false;
    }
  }, []);

  const checkConnection = useCallback(async () => {
    try {
      const installed = extractConnectionState(await isConnected());
      setIsInstalled(installed);

      if (installed) {
        const { address } = await getAddress();
        if (address) {
          setAddress(address);
          localStorage.setItem(STORAGE_KEY, address);
          await checkNetwork();
        }
      }
    } catch (e) {
      console.error('Check connection failed', e);
    }
  }, [checkNetwork]);

  const attemptSilentReconnect = useCallback(async () => {
    const savedProvider = getStoredWalletProvider();
    setSelectedProvider(savedProvider);
    if (savedProvider === 'walletconnect') {
      const wcAddress = getWalletConnectAddress();
      if (wcAddress) {
        setAddress(wcAddress);
        localStorage.setItem(STORAGE_KEY, wcAddress);
      }
      return;
    }

    if (savedProvider !== 'freighter') {
      return;
    }

    setIsReconnecting(true);

    try {
      const installed = extractConnectionState(await isConnected());
      setIsInstalled(installed);

      if (!installed) {
        clearWalletStorage();
        setSelectedProvider(null);
        return;
      }

      const { address } = await getAddress();
      if (!address) {
        clearWalletStorage();
        setSelectedProvider(null);
        return;
      }

      setAddress(address);
      localStorage.setItem(STORAGE_KEY, address);
      await checkNetwork();
    } catch (e) {
      console.error('Silent reconnect failed', e);
      clearWalletStorage();
      setSelectedProvider(null);
    } finally {
      setIsReconnecting(false);
    }
  }, [checkNetwork]);

  useEffect(() => {
    attemptSilentReconnect();
  }, [attemptSilentReconnect]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    let cancelled = false;

    async function detectRoles(walletAddress: string) {
      setRolesLoading(true);
      try {
        const nextRoles = await getWalletRoles(walletAddress);
        if (!cancelled) setRoles(nextRoles);
      } catch (roleError) {
        console.error('Failed to detect wallet roles', roleError);
        if (!cancelled) setRoles([]);
      } finally {
        if (!cancelled) setRolesLoading(false);
      }
    }

    if (!address || networkMismatch) {
      setRoles([]);
      setRolesLoading(false);
      return;
    }

    void detectRoles(address);

    return () => {
      cancelled = true;
    };
  }, [address, networkMismatch]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (address) checkNetwork();
    }, 5000);
    return () => clearInterval(interval);
  }, [address, checkNetwork]);

  const warningToastIdRef = React.useRef<string | null>(null);
  const disconnectRef = React.useRef<() => void>(() => {});

  const disconnect = useCallback(() => {
    // Clear all in-memory wallet state...
    setAddress(null);
    setNetworkMismatch(false);
    setRpcMismatch(false);
    setMismatchDetails(null);
    setSwitchingNetwork(false);
    setWalletNetwork(null);
    setError(null);
    setRoles([]);
    setRolesLoading(false);
    setIsSelectingProvider(false);
    setSelectedProvider(null);
    setIsReconnecting(false);
    if (warningToastIdRef.current) {
      removeToast(warningToastIdRef.current);
      warningToastIdRef.current = null;
    }
    // ...and every persisted/cached trace of the session (#4).
    clearWalletStorage();
    void disconnectWalletConnect();
    trackEvent('wallet_disconnected');
    addToast({ type: 'success', title: 'Disconnected' });
    // Leave any wallet-gated view for the public home page.
    router.push('/');
  }, [addToast, removeToast, router]);

  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  const resetIdleTimer = useCallback(() => {
    if (warningToastIdRef.current) {
      removeToast(warningToastIdRef.current);
      warningToastIdRef.current = null;
    }
  }, [removeToast]);

  // Session/idle timeout effect (#668)
  useEffect(() => {
    if (!address) return;

    const timeout = idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    const warningMs = idleWarningMs ?? DEFAULT_WARNING_BEFORE_TIMEOUT_MS;
    const warningDelay = Math.max(100, timeout - warningMs);

    let warnTimer: ReturnType<typeof setTimeout> | null = null;
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const startTimers = () => {
      if (warnTimer) clearTimeout(warnTimer);
      if (disconnectTimer) clearTimeout(disconnectTimer);

      warnTimer = setTimeout(() => {
        const id = addToast({
          type: 'warning',
          title: 'Session Inactivity Warning',
          message: 'Your wallet session will disconnect soon due to inactivity.',
          action: {
            label: 'Stay Connected',
            onClick: () => {
              if (warningToastIdRef.current) {
                removeToast(warningToastIdRef.current);
                warningToastIdRef.current = null;
              }
              startTimers();
            },
          },
        });
        warningToastIdRef.current = id;
      }, warningDelay);

      disconnectTimer = setTimeout(() => {
        if (warningToastIdRef.current) {
          removeToast(warningToastIdRef.current);
          warningToastIdRef.current = null;
        }
        disconnectRef.current();
        addToast({
          type: 'info',
          title: 'Wallet Disconnected',
          message: 'Your wallet connection timed out due to inactivity.',
        });
      }, timeout);
    };

    startTimers();

    let lastActivity = Date.now();
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivity > 1000) {
        lastActivity = now;
        if (warningToastIdRef.current) {
          removeToast(warningToastIdRef.current);
          warningToastIdRef.current = null;
        }
        startTimers();
      }
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, handleActivity, { passive: true }));

    return () => {
      if (warnTimer) clearTimeout(warnTimer);
      if (disconnectTimer) clearTimeout(disconnectTimer);
      if (warningToastIdRef.current) {
        removeToast(warningToastIdRef.current);
        warningToastIdRef.current = null;
      }
      events.forEach((event) => window.removeEventListener(event, handleActivity));
    };
  }, [address, idleTimeoutMs, idleWarningMs, addToast, removeToast]);

  // Opening the wallet picker is what "Connect Wallet" now triggers (#2); the
  // actual per-provider connect runs once the user chooses.
  const connect = async () => {
    setError(null);
    setOpenWalletConnectByDefault(selectedProvider === 'walletconnect');
    setIsSelectingProvider(true);
  };

  const connectFreighter = async () => {
    setIsSelectingProvider(false);
    setError(null);
    const toastId = addToast({ type: 'pending', title: 'Connecting to Freighter...' });

    try {
      const installed = extractConnectionState(await isConnected());
      if (!installed) {
        const msg = 'Freighter not installed. Please install the extension.';
        setError(msg);
        updateToast(toastId, { type: 'error', title: 'Connection Failed', message: msg });
        window.open('https://www.freighter.app/', '_blank');
        return;
      }

      const isAllowed = extractAllowedState(await setAllowed());
      if (isAllowed) {
        const { address, error: freighterError } = await getAddress();

        if (freighterError) {
          setError(freighterError);
          updateToast(toastId, {
            type: 'error',
            title: 'Connection Failed',
            message: freighterError,
          });
          return;
        }

        if (address) {
          setAddress(address);
          localStorage.setItem(STORAGE_KEY, address);
          setSelectedProvider('freighter');
          setStoredWalletProvider('freighter');

          const isCorrectNetwork = await checkNetwork();
          if (!isCorrectNetwork) {
            const networkMsg = `Please switch Freighter to ${NETWORK_NAME}`;
            setError(networkMsg);
            updateToast(toastId, { type: 'error', title: 'Network Mismatch', message: networkMsg });
          } else {
            updateToast(toastId, {
              type: 'success',
              title: 'Connected',
              message: `Connected as ${address.substring(0, 6)}...`,
            });
            trackEvent('wallet_connected', { provider: 'freighter', network: NETWORK_NAME });
          }
        }
      } else {
        const msg = 'Connection rejected by user.';
        setError(msg);
        updateToast(toastId, { type: 'error', title: 'Connection Failed', message: msg });
      }
    } catch (e: any) {
      console.error('Connection error:', e);
      const msg = e.message || 'Connection failed';
      setError(msg);
      updateToast(toastId, { type: 'error', title: 'Connection Failed', message: msg });
    }
  };

  const connectWalletConnectProvider = async (customAddress?: string) => {
    setIsSelectingProvider(false);
    setError(null);
    const toastId = addToast({ type: 'pending', title: 'Connecting via WalletConnect...' });

    try {
      const session = await connectWalletConnect({ address: customAddress });
      if (session?.address) {
        setAddress(session.address);
        localStorage.setItem(STORAGE_KEY, session.address);
        setSelectedProvider('walletconnect');
        setStoredWalletProvider('walletconnect');
        updateToast(toastId, {
          type: 'success',
          title: 'Connected',
          message: `Connected as ${session.address.substring(0, 6)}... via WalletConnect`,
        });
        trackEvent('wallet_connected', { provider: 'walletconnect', network: NETWORK_NAME });
      }
    } catch (e: any) {
      console.error('WalletConnect error:', e);
      const msg = e.message || 'WalletConnect connection failed';
      setError(msg);
      updateToast(toastId, { type: 'error', title: 'Connection Failed', message: msg });
    }
  };

  const switchNetwork = useCallback(async () => {
    if (!address) return;
    setSwitchingNetwork(true);
    try {
      const targetNetwork = getConfiguredStellarNetwork() === 'mainnet' ? 'PUBLIC' : 'TESTNET';

      const freighterWindow = window as unknown as FreighterWindow;
      const extension = freighterWindow.stellar?.freighter || freighterWindow.freighter;
      if (extension?.setNetwork) {
        await extension.setNetwork(targetNetwork);
        await checkNetwork();
        if (!networkMismatch) {
          addToast({
            type: 'success',
            title: 'Network Switched',
            message: `Switched to ${NETWORK_NAME}`,
          });
        }
        return;
      }

      await requestAccess();
      addToast({
        type: 'info',
        title: 'Switch Network',
        message: `Please switch Freighter to ${NETWORK_NAME} in the extension popup.`,
      });
    } catch (e) {
      console.error('Failed to switch network', e);
      addToast({
        type: 'error',
        title: 'Switch Failed',
        message: `Could not switch network. Please manually switch Freighter to ${NETWORK_NAME}.`,
      });
    } finally {
      setSwitchingNetwork(false);
    }
  }, [address, networkMismatch, checkNetwork, addToast]);

  const signTx = async (txXdr: string) => {
    const isCorrectNetwork = await checkNetwork();
    if (!isCorrectNetwork) {
      const msg = `Network mismatch. Please switch to ${NETWORK_NAME}`;
      addToast({ type: 'error', title: 'Transaction Failed', message: msg });
      throw new Error(msg);
    }

    if (selectedProvider === 'walletconnect') {
      return await signTransactionWithWalletConnect(txXdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
      });
    }

    const signed = await signTransaction(txXdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    if (typeof signed === 'string') {
      return signed;
    }

    if (signed.error) {
      throw new Error(String(signed.error));
    }

    if (signed.signedTxXdr) {
      return signed.signedTxXdr;
    }

    throw new Error('Freighter did not return a signed transaction.');
  };

  const handleSelectWalletConnect = () => {
    setSelectedProvider('walletconnect');
    setStoredWalletProvider('walletconnect');
    void connectWalletConnectProvider();
  };

  return (
    <WalletContext.Provider
      value={{
        address,
        isConnected: !!address,
        isInstalled,
        isReconnecting,
        preferredWalletProvider: selectedProvider,
        error,
        networkMismatch,
        rpcMismatch,
        mismatchDetails,
        switchingNetwork,
        walletNetwork: walletNetwork ? normalizeWalletNetwork(walletNetwork) : null,
        roles,
        rolesLoading,
        connect,
        connectWalletConnect: connectWalletConnectProvider,
        disconnect,
        signTx,
        switchNetwork,
        resetIdleTimer,
      }}
    >
      {children}
      {isSelectingProvider ? (
        <WalletSelectionModal
          onClose={() => {
            setIsSelectingProvider(false);
            setOpenWalletConnectByDefault(false);
          }}
          onSelectFreighter={() => void connectFreighter()}
          onSelectWalletConnect={handleSelectWalletConnect}
          initialWalletConnectView={openWalletConnectByDefault}
        />
      ) : null}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
