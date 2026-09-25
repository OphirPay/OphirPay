import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import { getAppVersion, getPublicKey, signTransaction } from 'stellar-ledger-app';
import { WalletConnector } from './types';

const LEDGER_VENDOR_ID = 0x2c97;
const LEDGER_PRODUCT_ID = 0x0000;
const STELLAR_DERIVATION_PATH = "44'/148'/0'/0/0";

class LedgerWalletConnector implements WalletConnector {
  private transport: TransportWebUSB | null = null;

  id = 'ledger';
  name = 'Ledger Hardware Wallet';
  icon = '🔑';

  async isAvailable(): Promise<boolean> {
    return 'usb' in navigator && 'getDevices' in navigator.usb;
  }

  async isStellarAppOpen(): Promise<boolean> {
    if (!this.transport) return false;
    try {
      const version = await getAppVersion(this.transport);
      return version !== '0.0.0';
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    if (!this.transport) {
      try {
        const devices = await navigator.usb.getDevices();
        const ledgerDevice = devices.find(
          (d) => d.vendorId === LEDGER_VENDOR_ID && d.productId === LEDGER_PRODUCT_ID
        );

        if (!ledgerDevice) {
          throw new Error('No Ledger device found. Ensure it is connected and unlocked.');
        }

        this.transport = await TransportWebUSB.createFromDevice(ledgerDevice);
        if (!(await this.isStellarAppOpen())) {
          throw new Error('Stellar app not open on Ledger device.');
        }
      } catch (error) {
        throw new Error('Ledger connection failed: ' + error.message);
      }
    }
  }

  async getPublicKey(path: string = STELLAR_DERIVATION_PATH): Promise<string> {
    if (!this.transport) {
      await this.connect();
    }
    try {
      const publicKey = await getPublicKey(this.transport, path);
      return publicKey;
    } catch (error) {
      throw new Error('Failed to retrieve public key: ' + error.message);
    }
  }

  async signTransaction(tx: string, networkPassphrase: string): Promise<string> {
    if (!this.transport) {
      await this.connect();
    }
    try {
      const signedTx = await signTransaction(this.transport, tx, networkPassphrase);
      return signedTx;
    } catch (error) {
      throw new Error('Transaction signing failed: ' + error.message);
    }
  }
}

export const ledgerConnector: LedgerWalletConnector = new LedgerWalletConnector();