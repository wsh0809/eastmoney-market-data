import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { describe, it } from 'node:test';
import { runInNewContext, Script } from 'node:vm';
import { z } from 'zod';
import { beijingDate, createIntradayClient, sessionMinute } from '../src/intraday.ts';
import { escapeHtml, renderChartHtml, renderIntradaySvg } from '../src/intraday-chart.ts';

const date = '2026-11-02';
const bars = [
  `${date} 09:31,9.58,9.20,9.59,9.15,40446,38303572.00`,
  `${date} 09:32,9.20,9.21,9.24,9.14,27800,25550503.00`,
];
function payload(klines: string[] = bars) {
  return { rc: 0, data: { code: '600127', market: 1, name: '金健米业', decimal: 2, preKPrice: 9.54, klines } };
}
async function series() {
  const result = await createIntradayClient({ fetcher: async () => Response.json(payload()) }).getIntraday('600127', date);
  assert.ok(result.success);
  return result.data;
}

describe('东方财富一分钟数据', () => {
  it('should use Beijing calendar dates and collapse only the scheduled lunch break', () => {
    assert.equal(beijingDate(Date.parse(`${date}T16:01:00Z`)), '2026-11-03');
    assert.equal(sessionMinute('09:30'), 0);
    assert.equal(sessionMinute('11:30'), sessionMinute('13:00'));
    assert.equal(sessionMinute('15:00'), 240);
    for (const time of ['12:00', '09:29', '15:01', '10:99', 'garbage']) assert.equal(sessionMinute(time), null);
  });

  it('should request unadjusted one-minute bars for one exact date and preserve OHLC units', async () => {
    const client = createIntradayClient({ fetcher: async input => {
      assert.ok(input instanceof URL);
      assert.equal(input.searchParams.get('klt'), '1');
      assert.equal(input.searchParams.get('fqt'), '0');
      assert.equal(input.searchParams.get('beg'), date.replaceAll('-', ''));
      assert.equal(input.searchParams.get('end'), input.searchParams.get('beg'));
      return Response.json(payload());
    } });
    const result = await client.getIntraday('600127', date);
    assert.ok(result.success);
    assert.equal(result.data.points.length, bars.length);
    assert.equal(result.data.firstTime, bars[0]?.slice(11, 16));
    assert.equal(result.data.lastTime, bars.at(-1)?.slice(11, 16));
    assert.equal(result.data.previousClose, payload().data.preKPrice);
    assert.equal(result.data.hasClosingBar, false);
    assert.deepEqual(result.data.points[0], {
      time: '09:31', open: 9.58, close: 9.20, high: 9.59, low: 9.15, volumeLots: 40446, turnoverYuan: 38303572,
    });
  });

  it('should reject wrong dates, malformed bars, contradictory OHLC and duplicate times', async () => {
    for (const klines of [
      [bars[0]?.replace(date, '2026-10-30') ?? ''],
      [`${date} 09:31,,9.20,9.59,9.15,0,0`],
      [`${date} 09:31,9.58,9.20,9.00,9.15,0,0`],
      [`${date} 12:00,9.58,9.20,9.59,9.15,0,0`],
      [bars[0] ?? '', bars[0] ?? ''],
    ]) {
      const result = await createIntradayClient({ fetcher: async () => Response.json(payload(klines)) }).getIntraday('600127', date);
      assert.ok(!result.success);
      assert.equal(result.error.code, 'UPSTREAM_INVALID_DATA');
    }
  });

  it('should return not-found instead of silently substituting an earlier trading day', async () => {
    for (const response of [{ rc: 0, data: null }, payload([])]) {
      const result = await createIntradayClient({ fetcher: async () => Response.json(response) }).getIntraday('600127', date);
      assert.ok(!result.success);
      assert.equal(result.error.code, 'NOT_FOUND');
    }
  });

  it('should fail over only on transport failures and retain the actual source URL', async () => {
    const hosts: string[] = [];
    const client = createIntradayClient({ fetcher: async input => {
      assert.ok(input instanceof URL);
      hosts.push(input.hostname);
      if (hosts.length === 1) throw new TypeError('Simulated third-party socket failure');
      return Response.json(payload());
    } });
    const result = await client.getIntraday('600127', date);
    assert.ok(result.success);
    assert.equal(hosts.length, 2);
    assert.equal(new URL(result.data.sourceUrl).hostname, hosts.at(-1));
  });
});

describe('分钟价格图', () => {
  it('should render safe standalone SVG and keep future periods empty', async () => {
    const data = await series();
    const svg = renderIntradaySvg({ ...data, name: '<script>bad</script>' }, 360);
    assert.match(svg, /viewBox="0 0 360 280"/);
    assert.ok(!svg.includes('<script>'));
    assert.match(svg, /&lt;script&gt;/);
    assert.match(svg, /09:32/);
    assert.match(svg, /11:30 \/ 13:00/);
    const path = /<path d="([^"]*)"/.exec(svg)?.[1];
    assert.ok(path);
    const numbers = [...path.matchAll(/[ML]([\d.]+),/g)].map(match => Number(match[1]));
    assert.ok(Math.max(...numbers) < (360 - 20) / 2);
  });

  it('should run the same controlled renderer in a browser context without hidden Node dependencies', async () => {
    const data = await series();
    const renderer = stripTypeScriptTypes(`${escapeHtml.toString()}\n${sessionMinute.toString()}\n${renderIntradaySvg.toString()}`);
    const output: unknown = runInNewContext(`${renderer}\nrenderIntradaySvg(data, 360)`, { data });
    const parsed = z.string().safeParse(output);
    assert.ok(parsed.success);
    assert.equal(parsed.data, renderIntradaySvg(data, 360));
    const html = renderChartHtml([{ symbol: data.code, success: true, series: data }], date, renderer);
    assert.match(html, /application\/json/);
    assert.match(html, /ResizeObserver/);
    assert.ok(!html.includes('https://cdn'));
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Script(script));
  });
});
