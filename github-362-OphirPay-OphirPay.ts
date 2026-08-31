import { useEffect, useState, useCallback } from 'react';
import { useWeb3React } from '@web3-react/core';
import { Web3Provider } from '@ethersproject/providers';
import { injected } from '../connectors';

const WALLET_SESSION_KEY = 'ophirpay_wallet_session';

interface WalletSession {
  address: string;
  chainId: number;
  providerType: string;
}

const saveSession = (session: WalletSession): void => {
  try {
    localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.error('Failed to save wallet session:', error);
  }
};

const loadSession = (): WalletSession | null => {
  try {
    const data = localStorage.getItem(WALLET_SESSION_KEY);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Failed to load wallet session:', error);
    return null;
  }
};

const clearSession = (): void => {
  try {
    localStorage.removeItem(WALLET_SESSION_KEY);
  } catch (error) {
    console.error('Failed to clear wallet session:', error);
  }
};

export const useWalletPersistence = () => {
  const { active, account, chainId, connector, activate, deactivate } = useWeb3React<Web3Provider>();
  const [reconnecting, setReconnecting] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);

  // Save session when wallet connects
  useEffect(() => {
    if (active && account && chainId) {
      saveSession({
        address: account,
        chainId,
        providerType: connector?.name || 'unknown',
      });
    }
  }, [active, account, chainId, connector]);

  // Attempt reconnection on mount
  useEffect(() => {
    const restoreSession = async () => {
      const session = loadSession();
      if (!session || !session.address) return;

      setReconnecting(true);
      try {
        // Only reconnect if the connector supports this session
        if (connector?.name === session.providerType) {
          await activate(connector, () => {
            // Validation: ensure account matches
            if (account === session.address.toLowerCase()) {
              setSessionRestored(true);
            }
          });
        }
      } catch (error) {
        console.warn('Reconnection failed:', error);
        clearSession();
      } finally {
        setReconnecting(false);
      }
    };

    restoreSession();
  }, [activate, connector, account]);

  // Handle logout
  const handleLogout = useCallback(() => {
    clearSession();
    deactivate();
    setSessionRestored(false);
  }, [deactivate]);

  return {
    active,
    account,
    chainId,
    reconnecting,
    sessionRestored,
    handleLogout,
  };
};