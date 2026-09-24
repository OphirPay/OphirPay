import { sendEmail, EmailOptions } from '../../src/lib/email';
import nodemailer from 'nodemailer';
import { jest } from '@jest/globals';

jest.mock('nodemailer');

const mockSendMail = jest.fn();

const mockCreateTransport = nodemailer.createTransport as jest.Mock;
mockCreateTransport.mockReturnValue({
  sendMail: mockSendMail,
});

describe('sendEmail', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...originalEnv,
      EMAIL_HOST: 'smtp.test.com',
      EMAIL_PORT: '587',
      EMAIL_USER: 'user@test.com',
      EMAIL_PASS: 'pass',
      EMAIL_FROM: 'Test <test@test.com>',
      EMAIL_RETRY_COUNT: '2',
      EMAIL_RETRY_DELAY_MS: '10',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('succeeds when provider accepts the message', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: '123' });

    const options: EmailOptions = {
      to: 'recipient@example.com',
      subject: 'Test',
      template: 'paymentSent',
      data: { amount: '10', currency: 'USD' },
    };

    const result = await sendEmail(options);
    expect(result).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('retries on provider error and ultimately fails', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP error'));
    mockSendMail.mockRejectedValueOnce(new Error('SMTP error'));

    const options: EmailOptions = {
      to: 'recipient@example.com',
      subject: 'Test',
      template: 'paymentSent',
      data: { amount: '10', currency: 'USD' },
    };

    const result = await sendEmail(options);
    expect(result).toBe(false);
    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });

  it('throws if required env vars are missing', () => {
    delete process.env.EMAIL_HOST;
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../src/lib/email');
    }).toThrow(/Missing required email configuration/);
  });
});
