export interface WalletConnector {
  id: string;
  name: string;
  icon: string;
  connect: () => Promise<void>;
  getPublicKey: (path?: string) => Promise<string>;
  signTransaction: (tx: string, networkPassphrase: string) => Promise<string>;
  isAvailable: () => Promise<boolean>;
}

export interface LedgerConnector extends WalletConnector {
  isStellarAppOpen: () => Promise<boolean>;
}