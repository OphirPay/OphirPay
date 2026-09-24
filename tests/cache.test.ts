import { cache } from '@/src/lib/cache';

describe('Cache layer (Redis fallback aware)', () => {
  const TEST_KEY = 'test:cache';
  const TEST_VALUE = JSON.stringify({ hello: 'world' });
  const TTL = 2; // seconds

  afterAll(async () => {
    // Clean up in case the test runs against a real Redis instance.
    await cache.del(TEST_KEY);
  });

  test('set → get returns the stored value', async () => {
    await cache.set(TEST_KEY, TEST_VALUE, TTL);
    const got = await cache.get(TEST_KEY);
    expect(got).toBe(TEST_VALUE);
  });

  test('value expires after TTL', async () => {
    await cache.set(TEST_KEY, TEST_VALUE, 1);
    // Wait a little longer than 1 second.
    await new Promise((r) => setTimeout(r, 1100));
    const expired = await cache.get(TEST_KEY);
    expect(expired).toBeNull();
  });

  test('invalidatePrefix removes matching keys', async () => {
    await cache.set('api:stats', '1', TTL);
    await cache.set('api:analytics', '2', TTL);
    await cache.invalidatePrefix('api:');
    const stats = await cache.get('api:stats');
    const analytics = await cache.get('api:analytics');
    expect(stats).toBeNull();
    expect(analytics).toBeNull();
  });
});
