import assert from 'node:assert/strict';
import { batchConfigSchema, type ConfigLoadResult } from '../src/batch-config.ts';
import { createEastmoneyClient } from '../src/eastmoney.ts';
import { createIntradayClient } from '../src/intraday.ts';
import { payloadWithRow, quoteRow } from './fixtures.ts';

export const dashboardNow = quoteRow.f124 * 1000;
export const dashboardConfig = batchConfigSchema.parse({ stocks: [{ symbol: quoteRow.f12, label: quoteRow.f14 }] });
export function readDashboardConfig(): Promise<ConfigLoadResult> {
  return Promise.resolve({ success: true, data: { path: '/test/config/stocks.json', directory: '/test/config', config: dashboardConfig } });
}
export async function dashboardSnapshot() {
  const result = await createEastmoneyClient({ fetcher: async () => Response.json(payloadWithRow()), now: () => dashboardNow })
    .getSnapshot(quoteRow.f12);
  assert.ok(result.success);
  return result.data;
}
export async function dashboardIntraday() {
  const result = await createIntradayClient({ fetcher: async () => Response.json({ rc: 0, data: {
    code: quoteRow.f12, market: 1, name: quoteRow.f14, decimal: 2, preKPrice: quoteRow.f18,
    klines: ['2026-11-02 09:31,9.58,9.20,9.59,9.15,40446,38303572.00'],
  } }), now: () => dashboardNow }).getIntraday(quoteRow.f12, '2026-11-02');
  assert.ok(result.success);
  return result.data;
}
