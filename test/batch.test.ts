import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { analyzeSnapshot } from '../src/analysis.ts';
import { runBatch } from '../src/batch.ts';
import { batchConfigSchema, loadBatchConfig } from '../src/batch-config.ts';
import { renderBatchMarkdown, writeBatchReport } from '../src/batch-report.ts';
import { createEastmoneyClient } from '../src/eastmoney.ts';
import type { Snapshot } from '../src/eastmoney.ts';
import { payloadWithRow, quoteRow } from './fixtures.ts';

async function snapshot(): Promise<Snapshot> {
  const client = createEastmoneyClient({
    fetcher: async () => Response.json(payloadWithRow()),
    now: () => quoteRow.f124 * 1000,
  });
  const result = await client.getSnapshot(quoteRow.f12);
  assert.ok(result.success);
  return result.data;
}

describe('股票批量配置', () => {
  it('should preserve optional basic info and reject inconsistent markets and security types', () => {
    const basicInfo = {
      name: quoteRow.f14,
      market: 'SH',
      securityType: 'stock',
      industry: '农产品加工',
      source: 'eastmoney',
      fetchedAt: new Date(quoteRow.f124 * 1000).toISOString(),
    };
    const valid = batchConfigSchema.safeParse({ stocks: [{ symbol: quoteRow.f12, basicInfo }] });
    assert.ok(valid.success);
    assert.deepEqual(valid.data.stocks[0]?.basicInfo, basicInfo);
    for (const change of [{ market: 'SZ' }, { securityType: 'etf' }, { fetchedAt: 'invalid-date' }]) {
      assert.equal(batchConfigSchema.safeParse({
        stocks: [{ symbol: quoteRow.f12, basicInfo: { ...basicInfo, ...change } }],
      }).success, false);
    }
    const etf = batchConfigSchema.safeParse({ stocks: [{
      symbol: '159502',
      basicInfo: { ...basicInfo, name: 'ETF', market: 'SZ', securityType: 'etf', industry: null },
    }] });
    assert.ok(etf.success);
    assert.equal(etf.data.stocks[0]?.basicInfo?.industry, null);
  });

  it('should supply defaults and accept a list with individual enable switches', () => {
    const parsed = batchConfigSchema.safeParse({ stocks: [
      { symbol: quoteRow.f12 }, { symbol: '000001', enabled: false },
    ] });
    assert.ok(parsed.success);
    assert.ok(parsed.data.stocks[0]?.enabled);
    assert.equal(parsed.data.stocks[1]?.enabled, false);
    assert.ok(parsed.data.request.intervalMs >= 500);
    assert.ok(parsed.data.analysis.priceChangeThresholdPercent > 0);
    assert.ok(parsed.data.output.formats.includes('json'));
  });

  it('should reject aliases of duplicate enabled stocks and invalid configuration before any fetch', () => {
    for (const input of [
      { stocks: [] },
      { stocks: [{ symbol: quoteRow.f12, enabled: false }] },
      { stocks: [{ symbol: quoteRow.f12 }, { symbol: `SH${quoteRow.f12}` }] },
      { stocks: [{ symbol: `SZ${quoteRow.f12}` }] },
      { stocks: [{ symbol: quoteRow.f12 }], request: { intervalMs: 0 } },
      { stocks: [{ symbol: quoteRow.f12 }], analysis: { mainFlowThresholdPercent: 0 } },
      { stocks: [{ symbol: quoteRow.f12 }], output: { formats: ['json', 'json'] } },
      { stocks: [{ symbol: quoteRow.f12 }], anlysis: {} },
    ]) assert.equal(batchConfigSchema.safeParse(input).success, false);
    assert.ok(batchConfigSchema.safeParse({ stocks: [
      { symbol: quoteRow.f12 }, { symbol: `SH${quoteRow.f12}`, enabled: false },
    ] }).success);
  });

  it('should distinguish unreadable, malformed and schema-invalid files from a usable config', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'eastmoney-config-'));
    const path = join(directory, 'stocks.json');
    try {
      assert.equal((await loadBatchConfig(path)).success, false);
      await writeFile(path, '{');
      assert.equal((await loadBatchConfig(path)).success, false);
      await writeFile(path, JSON.stringify({ stocks: [{ symbol: 'bad' }] }));
      const invalid = await loadBatchConfig(path);
      assert.ok(!invalid.success);
      assert.match(invalid.error.message, /stocks\.0\.symbol/);
      await writeFile(path, JSON.stringify({ stocks: [{ symbol: quoteRow.f12 }] }));
      const loaded = await loadBatchConfig(path);
      assert.ok(loaded.success);
      assert.equal(loaded.data.directory, directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('按可配置阈值分析快照', () => {
  it('should respect inclusive thresholds and symmetry between stronger and weaker states', async () => {
    const base = await snapshot();
    const config = batchConfigSchema.parse({ stocks: [{ symbol: quoteRow.f12 }] });
    const settings = config.analysis;
    for (const direction of [1, -1]) {
      const value = {
        ...base,
        quote: { ...base.quote, changePercent: direction * settings.priceChangeThresholdPercent },
        fundFlow: { ...base.fundFlow, main: {
          ...base.fundFlow.main, netRatioPercent: direction * settings.mainFlowThresholdPercent,
        } },
      };
      const analysis = analyzeSnapshot(value, settings);
      assert.equal(analysis.assessment, direction > 0 ? 'strong' : 'weak');
      const stricter = analyzeSnapshot(value, {
        ...settings,
        priceChangeThresholdPercent: settings.priceChangeThresholdPercent * 2,
        mainFlowThresholdPercent: settings.mainFlowThresholdPercent * 2,
      });
      assert.equal(stricter.assessment, 'neutral');
      const divergent = analyzeSnapshot({
        ...value, quote: { ...value.quote, changePercent: -value.quote.changePercent },
      }, settings);
      assert.equal(divergent.assessment, 'divergent');
    }
  });

  it('should flag older snapshots, unknown fields and no-trade snapshots without inventing signals', async () => {
    const base = await snapshot();
    const { analysis: settings } = batchConfigSchema.parse({ stocks: [{ symbol: quoteRow.f12 }] });
    const older = analyzeSnapshot({ ...base, ageSeconds: settings.maxSnapshotAgeSeconds + 1 }, settings);
    assert.ok(older.olderThanConfiguredLimit);
    for (const change of [
      { latestPrice: null }, { changePercent: null }, { turnoverYuan: 0 }, { turnoverYuan: null },
    ]) {
      const analyzed = analyzeSnapshot({ ...base, quote: { ...base.quote, ...change } }, settings);
      assert.equal(analyzed.assessment, 'insufficient-data');
    }
    const threshold = analyzeSnapshot({
      ...base, quote: { ...base.quote, turnoverRatePercent: settings.highTurnoverThresholdPercent },
    }, settings);
    assert.equal(threshold.highTurnover, true);
  });
});

describe('股票批量执行与报告', () => {
  it('should retain ETF price precision and treat missing fund flow as insufficient data', async () => {
    const config = batchConfigSchema.parse({ stocks: [{ symbol: '159502' }] });
    const client = createEastmoneyClient({ fetcher: async input => {
      assert.ok(input instanceof URL);
      assert.equal(input.searchParams.get('secids'), '0.159502');
      return Response.json(payloadWithRow({
        ...quoteRow, f12: '159502', f14: 'ETF', f2: 1.237,
        f62: '-', f66: '-', f69: '-', f72: '-', f75: '-', f78: '-', f81: '-', f84: '-', f87: '-',
      }));
    } });
    const report = await runBatch(config, client);
    assert.equal(report.summary.succeeded, 1);
    const item = report.items[0];
    assert.ok(item?.success);
    assert.equal(item.analysis.assessment, 'insufficient-data');
    assert.equal(item.snapshot.fundFlow.main.netAmountYuan, null);
    assert.match(renderBatchMarkdown(report), /1\.237/);
  });

  it('should skip disabled stocks, pace requests and continue after a per-stock failure', async () => {
    const config = batchConfigSchema.parse({ stocks: [
      { symbol: quoteRow.f12 }, { symbol: '000001', enabled: false },
      { symbol: '600519' }, { symbol: '300750' },
    ] });
    const requested: string[] = [];
    const waits: number[] = [];
    const client = createEastmoneyClient({ fetcher: async input => {
      assert.ok(input instanceof URL);
      const code = input.searchParams.get('secids')?.split('.')[1];
      assert.ok(code);
      requested.push(code);
      return Response.json(code === '600519' ? { rc: 0, data: null }
        : payloadWithRow({ ...quoteRow, f12: code }));
    } });
    const report = await runBatch(config, client, { wait: async ms => { waits.push(ms); } });
    assert.deepEqual(requested, config.stocks.filter(stock => stock.enabled).map(stock => stock.symbol));
    assert.equal(report.summary.failed, 1);
    assert.equal(report.summary.succeeded + report.summary.failed + report.summary.skipped, report.summary.configured);
    assert.equal(waits.length, report.summary.enabled - 1);
    assert.ok(waits.every(ms => ms === config.request.intervalMs));
    assert.ok(report.items.at(-1)?.success);
    assert.match(renderBatchMarkdown(report), /失败/);
  });

  it('should write both formats relative to the configuration file without overwriting earlier runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'eastmoney-report-'));
    try {
      const config = batchConfigSchema.parse({
        stocks: [{ symbol: quoteRow.f12 }], output: { directory: './output' },
      });
      const report = await runBatch(config, {
        getSnapshot: async () => ({ success: true, data: await snapshot() }),
      });
      const loaded = { config, directory, path: join(directory, 'stocks.json') };
      const first = await writeBatchReport(report, loaded);
      const second = await writeBatchReport(report, loaded);
      assert.ok(first.success && second.success);
      assert.equal(first.data.directory, resolve(directory, config.output.directory));
      assert.equal(first.data.files.length, config.output.formats.length);
      assert.ok(first.data.files.every(path => !second.data.files.includes(path)));
      for (const path of first.data.files) {
        const content = await readFile(path, 'utf8');
        if (path.endsWith('.json')) assert.deepEqual(JSON.parse(content), report);
        else {
          assert.match(content, /金健米业/);
          assert.match(content, /仅按单次行情快照/);
        }
      }
      const blocked = join(directory, 'file-not-directory');
      await writeFile(blocked, 'existing');
      const failure = await writeBatchReport(report, {
        ...loaded, config: { ...config, output: { ...config.output, directory: blocked } },
      });
      assert.ok(!failure.success);
      assert.equal(failure.error.code, 'OUTPUT_ERROR');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
