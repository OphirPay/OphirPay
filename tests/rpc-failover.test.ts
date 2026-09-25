import { withFailover, getRpcFailoverState, RpcEndpoint } from '../src/lib/rpc-failover';

jest.mock('../src/lib/rpc-failover', () => {
  const original = jest.requireActual('../src/lib/rpc-failover');
  return {
    ...original,
    // override endpoints for testing
    endpoints: [
      { name: 'primary', url: 'http://primary' },
      { name: 'secondary', url: 'http://secondary' },
    ],
  };
});

describe('RPC failover', () => {
  it('should switch to secondary on primary failure', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('primary fail'))
      .mockResolvedValueOnce('success');

    const result = await withFailover<string>((endpoint: RpcEndpoint) => fn(endpoint));

    expect(result).toBe('success');
    const state = getRpcFailoverState();
    expect(state.failoverCount).toBe(1);
    expect(state.activeEndpoint.name).toBe('secondary');
    expect(state.lastFailureReason['primary']).toBe('primary fail');
  });

  it('should not failover if primary succeeds', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withFailover<string>((endpoint: RpcEndpoint) => fn(endpoint));
    expect(result).toBe('ok');
    const state = getRpcFailoverState();
    expect(state.failoverCount).toBe(1); // from previous test
    expect(state.activeEndpoint.name).toBe('secondary'); // still secondary
  });
});
