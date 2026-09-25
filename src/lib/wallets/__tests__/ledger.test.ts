import { ledgerConnector } from '../ledger';
import TransportWebUSB from '@ledgerhq/hw-transport-webusb';

jest.mock('@ledgerhq/hw-transport-webusb', () => {
  return {
    createFromDevice: jest.fn(),
  };
});

jest.mock('stellar-ledger-app', () => {
  return {
    getAppVersion: jest.fn(),
    getPublicKey: jest.fn(),
    signTransaction: jest.fn(),
  };
});

describe('LedgerWalletConnector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ledgerConnector as any).transport = null;
  });

  describe('isAvailable', () => {
    it('returns false when WebUSB is not supported', async () => {
      delete (navigator as any).usb;
      expect(await ledgerConnector.isAvailable()).toBe(false);
    });

    it('returns true when WebUSB is supported', async () => {
      (navigator as any).usb = { getDevices: jest.fn() };
      expect(await ledgerConnector.isAvailable()).toBe(true);
    });
  });

  describe('connect', () => {
    it('throws when no Ledger device is found', async () => {
      (navigator as any).usb = {
        getDevices: jest.fn().mockResolvedValue([]),
      };

      await expect(ledgerConnector.connect()).rejects.toThrow('No Ledger device found');
    });

    it('throws when Stellar app is not open', async () => {
      (navigator as any).usb = {
        getDevices: jest.fn().mockResolvedValue([{ vendorId: 0x2c97, productId: 0x0000 }]),
      };
      (TransportWebUSB.createFromDevice as jest.Mock).mockResolvedValue({} as any);
      (require('stellar-ledger-app').getAppVersion as jest.Mock).mockResolvedValue('0.0.0');

      await expect(ledgerConnector.connect()).rejects.toThrow('Stellar app not open');
    });
  });

  describe('getPublicKey', () => {
    it('retrieves public key successfully', async () => {
      (ledgerConnector as any).transport = {} as any;
      (require('stellar-ledger-app').getPublicKey as jest.Mock).mockResolvedValue('GCPUBKEY');

      expect(await ledgerConnector.getPublicKey()).toBe('GCPUBKEY');
    });
  });

  describe('signTransaction', () => {
    it('signs transaction successfully', async () => {
      (ledgerConnector as any).transport = {} as any;
      (require('stellar-ledger-app').signTransaction as jest.Mock).mockResolvedValue('SIGNED_TX');

      expect(await ledgerConnector.signTransaction('TX', 'TESTNET')).toBe('SIGNED_TX');
    });
  });
});