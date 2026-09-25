import { describe, expect, test } from '@jest/globals';
import { GET as proposalsGet } from '@/app/api/governance/proposals/[id]/route';

describe('Governance API', () => {
  test('should return proposal details for valid ID', async () => {
    const mockRequest = new Request('http://localhost/api/governance/proposals/1');
    const response = await proposalsGet(mockRequest, { params: { id: '1' } });

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.proposal).toBeDefined();
    expect(data.data.config).toBeDefined();
    expect(data.data.votes).toBeInstanceOf(Array);
  });

  test('should return error for invalid ID', async () => {
    const mockRequest = new Request('http://localhost/api/governance/proposals/invalid');
    const response = await proposalsGet(mockRequest, { params: { id: 'invalid' } });

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  });
});