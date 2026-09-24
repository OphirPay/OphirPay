import { buildSlackPayload } from '@/app/webhooks/adapters/slackAdapter';
import { buildDiscordPayload } from '@/app/webhooks/adapters/discordAdapter';

type PaymentEvent = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  createdAt: string;
  transactionHash?: string;
  metadata?: Record<string, unknown>;
};

const sampleEvent: PaymentEvent = {
  id: 'pay_12345',
  amount: '150.00',
  currency: 'USD',
  status: 'succeeded',
  createdAt: '2024-09-20T12:34:56Z',
  transactionHash: '0xdeadbeef',
  metadata: {
    donor: 'Alice',
    campaign: 'Open Source Fund',
  },
};

describe('Slack adapter', () => {
  it('produces a payload matching the schema', () => {
    const payload = buildSlackPayload(sampleEvent);
    expect(payload).toHaveProperty('text');
    expect(payload).toHaveProperty('blocks');
    expect(Array.isArray(payload.blocks)).toBe(true);
    // Basic sanity checks
    const textBlock = payload.blocks.find(
      (b: any) => b.type === 'section' && b.text?.type === 'mrkdwn',
    );
    expect(textBlock).toBeDefined();
    expect(textBlock.text.text).toContain('Payment SUCCEEDED');
    expect(textBlock.text.text).toContain('150.00 USD');
    expect(textBlock.text.text).toContain('pay_12345');
  });
});

describe('Discord adapter', () => {
  it('produces a payload with an embed', () => {
    const payload = buildDiscordPayload(sampleEvent);
    expect(payload).toHaveProperty('embeds');
    expect(Array.isArray(payload.embeds)).toBe(true);
    const embed = payload.embeds[0];
    expect(embed.title).toBe('Payment succeeded');
    expect(embed.fields?.some((f: any) => f.name === 'Amount' && f.value === '150.00 USD')).toBe(
      true,
    );
    expect(embed.fields?.some((f: any) => f.name === 'Payment ID' && f.value === '`pay_12345`')).toBe(
      true,
    );
    expect(embed.fields?.some((f: any) => f.name === 'Tx Hash' && f.value === '`0xdeadbeef`')).toBe(
      true,
    );
    // Metadata should be rendered as a separate field
    expect(embed.fields?.some((f: any) => f.name === 'Metadata')).toBe(true);
  });
});
