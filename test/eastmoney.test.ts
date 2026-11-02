import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEastmoneyClient } from '../src/eastmoney.ts';
import { resolveStock } from '../src/stock.ts';
import { payloadWithRow, quoteRow } from './fixtures.ts';

const fetchedAtMs = (quoteRow.f124 + 5) * 1000;
function clientFor(payload: unknown, nowMs = fetchedAtMs) {
  return createEastmoneyClient({ fetcher: async () => Response.json(payload), now: () => nowMs });
}

describe('A 股代码识别', () => {
  it('should recognize bare, prefixed and suffixed symbols across all three markets', () => {
    for (const example of [
      { symbols: ['600127', ' sh600127 ', '600127.sh'], secid: '1.600127', market: 'SH' },
      { symbols: ['000001', 'sz000001', '000001.SZ'], secid: '0.000001', market: 'SZ' },
      { symbols: ['300750'], secid: '0.300750', market: 'SZ' },
      { symbols: ['159502', 'sz159502', '159502.SZ'], secid: '0.159502', market: 'SZ' },
      { symbols: ['920001', 'BJ920001'], secid: '0.920001', market: 'BJ' },
      { symbols: ['430047', '830799.BJ'], market: 'BJ' },
    ]) {
      for (const symbol of example.symbols) {
        const result = resolveStock(symbol);
        assert.ok(result.success);
        assert.equal(result.data.market, example.market);
        if (example.secid) assert.equal(result.data.secid, example.secid);
      }
    }
  });

  it('should reject missing, malformed, unsupported and contradictory symbols as data', () => {
    for (const symbol of [null, undefined, 600127, '', '600127&x=y', 'SZ600127', '600127.SZ', '123456', 'SH600127.SH', 'SH159502', '159502.SH']) {
      const result = resolveStock(symbol);
      assert.equal(result.success, false);
      if (!result.success) assert.equal(result.error.code, 'INVALID_INPUT');
    }
  });
});

describe('东方财富公开接口边界', () => {
  it('should preserve yuan, percent and lot units without applying a second price scaling', async () => {
    const result = await clientFor(payloadWithRow()).getSnapshot(quoteRow.f12);
    assert.ok(result.success);
    assert.equal(result.data.quote.latestPrice, quoteRow.f2);
    assert.equal(result.data.quote.changePercent, quoteRow.f3);
    assert.equal(result.data.quote.volumeShares, quoteRow.f5 * 100);
    assert.equal(result.data.quote.turnoverYuan, quoteRow.f6);
    assert.equal(result.data.fundFlow.main.netAmountYuan, quoteRow.f66 + quoteRow.f72);
    assert.equal(result.data.fundFlow.main.netRatioPercent, quoteRow.f62 / quoteRow.f6 * 100);
    assert.equal(result.data.quoteTime, new Date(quoteRow.f124 * 1000).toISOString());
    assert.match(result.data.quoteTimeBeijing, /2026-11-02 09:54:35 \+08:00/);
    assert.equal(result.data.ageSeconds, (fetchedAtMs - quoteRow.f124 * 1000) / 1000);
    assert.equal(result.data.freshness, 'recent');
  });

  it('should keep missing and unavailable numbers null instead of inventing zero', async () => {
    const result = await clientFor(payloadWithRow({ ...quoteRow, f2: '-', f5: null, f6: '-', f66: undefined }))
      .getSnapshot(quoteRow.f12);
    assert.ok(result.success);
    assert.equal(result.data.quote.latestPrice, null);
    assert.equal(result.data.quote.volumeShares, null);
    assert.equal(result.data.fundFlow.superLarge.netAmountYuan, null);
    assert.equal(result.data.fundFlow.main.netRatioPercent, null);
  });

  it('should retain the actual market timestamp when an after-hours snapshot is old', async () => {
    const result = await clientFor(payloadWithRow(), fetchedAtMs + 86400000).getSnapshot(quoteRow.f12);
    assert.ok(result.success);
    assert.equal(result.data.freshness, 'older-snapshot');
    assert.equal(result.data.quoteTime, new Date(quoteRow.f124 * 1000).toISOString());
  });

  it('should request a fixed HTTPS endpoint and explicitly ask for unscaled prices', async () => {
    let calls = 0;
    const client = createEastmoneyClient({ fetcher: async (input, init) => {
      calls++;
      assert.ok(input instanceof URL);
      assert.equal(input.origin, 'https://push2.eastmoney.com');
      assert.equal(input.searchParams.get('secids'), `1.${quoteRow.f12}`);
      assert.equal(input.searchParams.get('fltt'), '2');
      assert.ok(init?.signal instanceof AbortSignal);
      return Response.json(payloadWithRow());
    } });
    await client.getSnapshot('600127&secids=0.000001');
    assert.equal(calls, 0);
    const result = await client.getSnapshot(quoteRow.f12);
    assert.ok(result.success);
    assert.equal(calls, 1);
  });

  it('should return not-found for empty results and upstream errors for a nonzero business code', async () => {
    for (const data of [null, { diff: [] }]) {
      const result = await clientFor({ rc: 0, data }).getSnapshot(quoteRow.f12);
      assert.ok(!result.success);
      assert.equal(result.error.code, 'NOT_FOUND');
    }
    const rejected = await clientFor({ rc: 1, data: null }).getSnapshot(quoteRow.f12);
    assert.ok(!rejected.success);
    assert.equal(rejected.error.code, 'UPSTREAM_REJECTED');
  });

  it('should reject changed structures, invalid numbers, wrong stocks and absent timestamps', async () => {
    for (const payload of [
      {}, { rc: 0, data: { diff: {} } },
      payloadWithRow({ ...quoteRow, f2: '9.80' }),
      payloadWithRow({ ...quoteRow, f12: '600519' }),
      payloadWithRow({ ...quoteRow, f124: 0 }),
      payloadWithRow({ ...quoteRow, f124: undefined }),
    ]) {
      const result = await clientFor(payload).getSnapshot(quoteRow.f12);
      assert.ok(!result.success);
      assert.equal(result.error.code, 'UPSTREAM_INVALID_DATA');
    }
  });

  it('should fall back after a temporary server error and retain the actual source URL', async () => {
    let calls = 0;
    const hosts: string[] = [];
    const client = createEastmoneyClient({ retryDelayMs: 0, fetcher: async input => {
      calls++;
      assert.ok(input instanceof URL);
      hosts.push(input.hostname);
      return calls === 1 ? new Response(null, { status: 503 }) : Response.json(payloadWithRow());
    } });
    const result = await client.getSnapshot(quoteRow.f12);
    assert.ok(result.success);
    assert.deepEqual(hosts, ['push2.eastmoney.com', 'push2delay.eastmoney.com']);
    assert.equal(new URL(result.data.sourceUrl).hostname, hosts.at(-1));
    assert.equal(calls, 2);
  });

  it('should limit network retries and convert a fetch exception into a typed failure', async () => {
    let calls = 0;
    const client = createEastmoneyClient({ retryDelayMs: 0, fetcher: async () => {
      calls++;
      throw new TypeError('Simulated third-party fetch failure');
    } });
    const result = await client.getSnapshot(quoteRow.f12);
    assert.ok(!result.success);
    assert.equal(result.error.code, 'UPSTREAM_UNAVAILABLE');
    assert.equal(calls, 2);
  });

  it('should avoid retrying access denials and malformed JSON', async () => {
    for (const response of [new Response(null, { status: 403 }), new Response('<html>blocked</html>')]) {
      let calls = 0;
      const client = createEastmoneyClient({ fetcher: async () => { calls++; return response; } });
      const result = await client.getSnapshot(quoteRow.f12);
      assert.ok(!result.success);
      assert.equal(calls, 1);
    }
  });
});
