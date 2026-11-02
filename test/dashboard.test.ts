import assert from 'node:assert/strict';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import { batchConfigSchema } from '../src/batch-config.ts';
import { createDashboardService } from '../src/dashboard.ts';
import { DASHBOARD_REFRESH_MS, dashboardResponseSchema } from '../src/dashboard-schema.ts';
import { createEastmoneyClient } from '../src/eastmoney.ts';
import { createHttpServer } from '../src/http-server.ts';
import { failure } from '../src/result.ts';
import { dashboardConfig, dashboardIntraday, dashboardNow, dashboardSnapshot, readDashboardConfig } from './dashboard-fixtures.ts';
import { payloadWithRow } from './fixtures.ts';

describe('30 秒行情采集服务', () => {
  it('should coalesce concurrent readers and refresh at the 30-second boundary', async () => {
    const snapshot = await dashboardSnapshot();
    const intraday = await dashboardIntraday();
    let now = dashboardNow;
    let calls = 0;
    const service = createDashboardService({
      now: () => now, readConfig: readDashboardConfig,
      snapshotClient: { getSnapshot: async () => { calls++; return { success: true, data: snapshot }; } },
      intradayClient: { getIntraday: async () => ({ success: true, data: intraday }) },
    });
    const [first, other] = await Promise.all([service.getDashboard(), service.getDashboard()]);
    assert.ok(first.success && other.success);
    assert.equal(calls, 1);
    assert.equal(first.data.startedAt, other.data.startedAt);
    now += DASHBOARD_REFRESH_MS - 1;
    await service.getDashboard();
    assert.equal(calls, 1);
    now++;
    const updated = await service.getDashboard();
    assert.ok(updated.success);
    assert.equal(calls, 2);
    assert.notEqual(updated.data.startedAt, first.data.startedAt);
    assert.equal(dashboardResponseSchema.safeParse(updated).success, true);
  });

  it('should retain same-day successful data with its original timestamps after failures and clear it on a new day', async () => {
    const snapshot = await dashboardSnapshot();
    const intraday = await dashboardIntraday();
    let fail = false;
    let now = dashboardNow;
    const service = createDashboardService({
      now: () => now, readConfig: readDashboardConfig,
      snapshotClient: { getSnapshot: async () => fail ? failure('UPSTREAM_UNAVAILABLE', 'Test network failure') : { success: true, data: snapshot } },
      intradayClient: { getIntraday: async () => fail ? failure('UPSTREAM_UNAVAILABLE', 'Test network failure') : { success: true, data: intraday } },
    });
    await service.getDashboard();
    fail = true;
    now += DASHBOARD_REFRESH_MS;
    const stale = await service.getDashboard();
    assert.ok(stale.success);
    const item = stale.data.items[0];
    assert.ok(item?.snapshot && item.intraday);
    assert.ok(item.snapshotRetained && item.intradayRetained);
    assert.equal(item.snapshot.quoteTime, snapshot.quoteTime);
    assert.equal(item.snapshot.fetchedAt, snapshot.fetchedAt);
    assert.equal(item.snapshot.ageSeconds, DASHBOARD_REFRESH_MS / 1000);
    assert.equal(stale.data.summary.failed, 1);
    now += 86400000;
    const tomorrow = await service.getDashboard();
    assert.ok(tomorrow.success);
    assert.equal(tomorrow.data.items[0]?.snapshot, null);
    assert.equal(tomorrow.data.items[0]?.intraday, null);
  });

  it('should reread configuration and limit parallel security requests to two workers', async () => {
    const snapshot = await dashboardSnapshot();
    const intraday = await dashboardIntraday();
    let config = batchConfigSchema.parse({ stocks: [{ symbol: '600127' }, { symbol: '600519' }, { symbol: '000001' }] });
    let active = 0;
    let peak = 0;
    const queried: string[] = [];
    const waits: number[] = [];
    const service = createDashboardService({
      now: () => dashboardNow, wait: async ms => { waits.push(ms); },
      readConfig: async () => ({ success: true, data: { config, directory: '/test', path: '/test/stocks.json' } }),
      snapshotClient: { getSnapshot: async symbol => {
        assert.equal(typeof symbol, 'string');
        active++; peak = Math.max(peak, active); queried.push(String(symbol));
        await new Promise<void>(resolve => setImmediate(resolve));
        active--;
        return { success: true, data: snapshot };
      } },
      intradayClient: { getIntraday: async () => ({ success: true, data: intraday }) },
    });
    await service.getDashboard();
    assert.ok(peak <= 2);
    assert.deepEqual(queried, config.stocks.map(stock => stock.symbol));
    assert.ok(waits.every(ms => ms >= config.request.intervalMs));
    config = batchConfigSchema.parse({ stocks: [{ symbol: '600127' }, { symbol: '600519', enabled: false }] });
    const changed = await service.getDashboard();
    assert.ok(changed.success);
    assert.equal(changed.data.summary.total, 1);
    assert.equal(queried.at(-1), '600127');
  });
});

describe('Web 页面及看板接口', () => {
  it('should serve the page, local assets and a validated dashboard without changing existing endpoints', async () => {
    const snapshot = await dashboardSnapshot();
    const intraday = await dashboardIntraday();
    const service = createDashboardService({
      now: () => dashboardNow, readConfig: readDashboardConfig,
      snapshotClient: { getSnapshot: async () => ({ success: true, data: snapshot }) },
      intradayClient: { getIntraday: async () => ({ success: true, data: intraday }) },
    });
    const server = createHttpServer(createEastmoneyClient({ fetcher: async () => Response.json(payloadWithRow()) }), service);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const page = await fetch(base);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type') ?? '', /text\/html/);
      assert.match(await page.text(), /每 30 秒刷新/);
      assert.ok(page.headers.has('content-security-policy'));
      assert.equal((await fetch(`${base}/assets/dashboard.css`)).status, 200);
      const javascript = await fetch(`${base}/assets/dashboard.js`);
      assert.equal(javascript.status, 200);
      assert.match(javascript.headers.get('content-type') ?? '', /javascript/);
      const response = await fetch(`${base}/api/dashboard`);
      assert.equal(response.status, 200);
      const data: unknown = await response.json();
      const parsed = dashboardResponseSchema.safeParse(data);
      assert.ok(parsed.success && parsed.data.success);
      assert.equal(parsed.data.data.summary.total, dashboardConfig.stocks.length);
      assert.equal((await fetch(`${base}/api/quote?symbol=600127`)).status, 200);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
