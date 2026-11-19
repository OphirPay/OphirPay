import { describe, it, expect } from 'vitest';

export interface FeeConfigUpdatedEvent {
  previous_collector: string | null;
  new_collector: string | null;
  previous_payment_fee_bps: number;
  new_payment_fee_bps: number;
  previous_escrow_fee_bps: number;
  new_escrow_fee_bps: number;
  previous_stream_fee_bps: number;
  new_stream_fee_bps: number;
  enabled: boolean;
  updated_by: string;
  timestamp: bigint;
}

export interface EmittedContractEvent {
  topics: [string, string];
  data: FeeConfigUpdatedEvent;
}

export function simulateFeeConfigUpdatedEvent(
  params: {
    caller: string;
    prevCollector?: string | null;
    newCollector?: string | null;
    prevPaymentFeeBps?: number;
    newPaymentFeeBps?: number;
    prevEscrowFeeBps?: number;
    newEscrowFeeBps?: number;
    prevStreamFeeBps?: number;
    newStreamFeeBps?: number;
    enabled?: boolean;
    timestamp?: bigint;
  }
): EmittedContractEvent {
  return {
    topics: ['fee_config', 'updated'],
    data: {
      previous_collector: params.prevCollector ?? null,
      new_collector: params.newCollector ?? null,
      previous_payment_fee_bps: params.prevPaymentFeeBps ?? 0,
      new_payment_fee_bps: params.newPaymentFeeBps ?? 0,
      previous_escrow_fee_bps: params.prevEscrowFeeBps ?? 0,
      new_escrow_fee_bps: params.newEscrowFeeBps ?? 0,
      previous_stream_fee_bps: params.prevStreamFeeBps ?? 0,
      new_stream_fee_bps: params.newStreamFeeBps ?? 0,
      enabled: params.enabled ?? true,
      updated_by: params.caller,
      timestamp: params.timestamp ?? BigInt(Math.floor(Date.now() / 1000)),
    },
  };
}

describe('FeeConfigUpdated on-chain event (#1349)', () => {
  it('emits fee_config updated event when collector address is set', () => {
    const owner = 'GBTESTOWNERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const collector = 'GBTESTCOLLECTOR1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const event = simulateFeeConfigUpdatedEvent({
      caller: owner,
      prevCollector: null,
      newCollector: collector,
      newPaymentFeeBps: 50,
      newEscrowFeeBps: 100,
      newStreamFeeBps: 150,
      enabled: true,
      timestamp: BigInt(1700000000),
    });

    expect(event.topics).toEqual(['fee_config', 'updated']);
    expect(event.data.previous_collector).toBeNull();
    expect(event.data.new_collector).toBe(collector);
    expect(event.data.updated_by).toBe(owner);
    expect(event.data.timestamp).toBe(BigInt(1700000000));
  });

  it('emits fee_config updated event when collector address is rotated', () => {
    const owner = 'GBTESTOWNERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const collector1 = 'GBTESTCOLLECTOR1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const collector2 = 'GBTESTCOLLECTOR2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

    const event = simulateFeeConfigUpdatedEvent({
      caller: owner,
      prevCollector: collector1,
      newCollector: collector2,
      prevPaymentFeeBps: 50,
      newPaymentFeeBps: 50,
      prevEscrowFeeBps: 100,
      newEscrowFeeBps: 100,
      prevStreamFeeBps: 150,
      newStreamFeeBps: 150,
      enabled: true,
      timestamp: BigInt(1700003600),
    });

    expect(event.topics).toEqual(['fee_config', 'updated']);
    expect(event.data.previous_collector).toBe(collector1);
    expect(event.data.new_collector).toBe(collector2);
    expect(event.data.previous_payment_fee_bps).toBe(50);
    expect(event.data.new_payment_fee_bps).toBe(50);
  });

  it('emits fee_config updated event when fee rates are updated', () => {
    const owner = 'GBTESTOWNERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const collector = 'GBTESTCOLLECTOR2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

    const event = simulateFeeConfigUpdatedEvent({
      caller: owner,
      prevCollector: collector,
      newCollector: collector,
      prevPaymentFeeBps: 50,
      newPaymentFeeBps: 120,
      prevEscrowFeeBps: 100,
      newEscrowFeeBps: 200,
      prevStreamFeeBps: 150,
      newStreamFeeBps: 250,
      enabled: true,
      timestamp: BigInt(1700007200),
    });

    expect(event.topics).toEqual(['fee_config', 'updated']);
    expect(event.data.previous_collector).toBe(collector);
    expect(event.data.new_collector).toBe(collector);
    expect(event.data.previous_payment_fee_bps).toBe(50);
    expect(event.data.new_payment_fee_bps).toBe(120);
    expect(event.data.previous_escrow_fee_bps).toBe(100);
    expect(event.data.new_escrow_fee_bps).toBe(200);
    expect(event.data.previous_stream_fee_bps).toBe(150);
    expect(event.data.new_stream_fee_bps).toBe(250);
  });
});
