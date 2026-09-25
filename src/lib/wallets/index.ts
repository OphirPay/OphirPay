import { WalletConnector } from './types';
import { ledgerConnector } from './ledger';
import { stellarBaseConnector, stellarWalletConnector } from './stellar';

const connectors: WalletConnector[] = [];

async function initializeConnectors(): Promise<WalletConnector[]> {
  const availableConnectors = [];

  // Always available connectors
  availableConnectors.push(stellarBaseConnector, stellarWalletConnector);

  // Conditionally available connectors
  if (await ledgerConnector.isAvailable()) {
    availableConnectors.push(ledgerConnector);
  }

  return availableConnectors;
}

export { initializeConnectors };

export const getActiveWalletId = (): string | null => {
  // Implementation for tracking active wallet (e.g., via localStorage)
  return null;
};