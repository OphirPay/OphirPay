import next from 'next';
import supertest from 'supertest';
import { createEscrow, getEscrow, releaseEscrow, claimEscrow, cancelEscrow } from '@/lib/contract/escrow';
import { createStream, getStream, claimStream, cancelStream } from '@/lib/contract/stream';

jest.mock('@/lib/contract/escrow', () => ({
  createEscrow: jest.fn(),
  getEscrow: jest.fn(),
  releaseEscrow: jest.fn(),
  claimEscrow: jest.fn(),
  cancelEscrow: jest.fn(),
}));

jest.mock('@/lib/contract/stream', () => ({
  createStream: jest.fn(),
  getStream: jest.fn(),
  claimStream: jest.fn(),
  cancelStream: jest.fn(),
}));

describe('Escrows and Streams API E2E', () => {
  let server: ReturnType<typeof next>;
  let request: supertest.SuperTest<supertest.Test>;

  beforeAll(async () => {
    server = next({ dev: true, dir: process.cwd() });
    await server.prepare();
    request = supertest(server.getRequestHandler());
  });

  afterAll(async () => {
    await server.close();
  });

  // ... tests ...
});
