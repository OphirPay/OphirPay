import { describe, it, expect } from 'vitest';
import { exportToCsv } from '@/lib/csv';
import { getDateRange, getDateRangePresets } from '@/lib/date-range';
import { formatXlm, formatFiat, formatTokenAmount, formatCompact } from '@/lib/format-currency';
import { formatStroopsToXlm, formatBaseFee, estimateTotalCost } from '@/lib/gas-estimate';
import { estimateBatchFee } from '@/lib/fee-estimator';
import { getStructuredData } from '@/lib/json-ld';
import { canonicalUrl, breadcrumbJsonLd } from '@/lib/seo';
import { generateMetadata } from '@/lib/metadata-helpers';
import { captureHealthSnapshot, formatHealthSnapshot } from '@/lib/monitoring';
import { incMetric, getMetricsSnapshot, observeDbQuery } from '@/lib/metrics-counters';
import { PRELOAD_ROUTES } from '@/lib/prefetch';
import { sendEmail, EMAIL_TEMPLATES } from '@/lib/email';
import { trapFocus } from '@/lib/focus-trap';
import { hashMemo } from '@/lib/memo';

describe('csv', () => {
  it('exports', () => expect(() => exportToCsv([{name:'x'}],[{key:'name',header:'N'}],{filename:'t.csv'})).not.toThrow());
});
describe('date-range', () => {
  it('today', () => expect(getDateRange('today').label).toBe('Today'));
  it('7d', () => expect(getDateRange('7d').label).toContain('7'));
  it('presets', () => expect(getDateRangePresets().length).toBeGreaterThan(3));
});
describe('format-currency', () => {
  it('xlm', () => expect(formatXlm(10000000)).toContain('1'));
  it('fiat', () => expect(formatFiat(100)).toContain('$'));
  it('token', () => expect(formatTokenAmount(100,'USDC')).toContain('USDC'));
  it('compact', () => expect(formatCompact(1500)).toContain('K'));
});
describe('gas-estimate', () => {
  it('stroops', () => expect(formatStroopsToXlm(100)).toContain('XLM'));
  it('baseFee', () => expect(formatBaseFee(100)).toContain('minimum'));
  it('total', () => { const c = estimateTotalCost(3,100); expect(c.stroops).toBe(300); });
});
describe('fee-estimator', () => {
  it('batch', () => expect(estimateBatchFee(5,100)).toBe('500'));
});
describe('json-ld', () => {
  it('structured', () => { const d = getStructuredData(); expect(d['@type']).toBe('WebApplication'); });
});
describe('seo', () => {
  it('canonical', () => expect(canonicalUrl('/send')).toContain('/send'));
  it('breadcrumb', () => expect(breadcrumbJsonLd([{name:'a',url:'/'}]).itemListElement.length).toBe(1));
});
describe('metadata', () => {
  it('generates', () => expect(generateMetadata({title:'T',description:'D'}).title).toBe('T'));
  it('noIndex', () => expect(generateMetadata({title:'T',description:'D',noIndex:true}).robots).toEqual({index:false,follow:false}));
});
describe('monitoring', () => {
  it('snapshot', () => expect(captureHealthSnapshot().uptime).toBeGreaterThan(0));
  it('format', () => expect(formatHealthSnapshot(captureHealthSnapshot())).toContain('Uptime'));
});
describe('metrics', () => {
  it('inc', () => { incMetric('http_requests_total'); expect(getMetricsSnapshot().http_requests_total).toBeGreaterThan(0); });
  it('db', () => { observeDbQuery(0.1); expect(getMetricsSnapshot().db_query_duration_seconds_count).toBeGreaterThan(0); });
});
describe('prefetch', () => {
  it('routes', () => { expect(PRELOAD_ROUTES.length).toBeGreaterThan(0); expect(PRELOAD_ROUTES).toContain('/send'); });
});
describe('email', () => {
  it('dev', async () => expect(typeof await sendEmail({to:'t@t.com',subject:'S',html:'<p>H</p>'})).toBe('boolean'));
  it('templates', () => { expect(EMAIL_TEMPLATES.paymentSent('10','tx')).toHaveProperty('subject'); });
});
describe('focus-trap', () => {
  it('cleanup', () => { const d=document.createElement('div');d.innerHTML='<button>B</button>';document.body.appendChild(d);const c=trapFocus(d);expect(typeof c).toBe('function');c();document.body.removeChild(d); });
  it('empty', () => { const d=document.createElement('div');document.body.appendChild(d);const c=trapFocus(d);expect(typeof c).toBe('function');c();document.body.removeChild(d); });
});
describe('hashMemo', () => {
  it('hashes', async () => expect(await hashMemo('test')).toHaveLength(28));
});
