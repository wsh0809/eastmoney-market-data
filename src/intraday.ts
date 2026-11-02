import { z } from 'zod';
import type { ClientOptions } from './eastmoney.ts';
import { failure, success } from './result.ts';
import type { Result } from './result.ts';
import { resolveStock } from './stock.ts';
import type { MinuteBar, IntradaySeries } from './market-schemas.ts';
export type { MinuteBar, IntradaySeries } from './market-schemas.ts';

const decimalString = z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number).pipe(z.number().finite().nonnegative());
const priceString = decimalString.pipe(z.number().positive());
const minuteBarSchema = z.tuple([
  z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
  priceString, priceString, priceString, priceString, decimalString, decimalString,
]).rest(z.string());
const responseSchema = z.looseObject({ rc: z.number().int(), data: z.unknown().nullish() });
const seriesSchema = z.looseObject({
  code: z.string(), market: z.union([z.literal(0), z.literal(1)]), name: z.string().min(1),
  decimal: z.number().int().min(0).max(6).nullish(),
  preKPrice: z.number().finite().positive().nullish(),
  klines: z.array(z.string()).max(1000),
});
const hosts = ['https://push2his.eastmoney.com', 'https://push2delay.eastmoney.com'];

export function beijingDate(milliseconds = Date.now()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(new Date(milliseconds));
}

// 将午休压缩到 11:30 / 13:00 这一分界，返回距离 09:30 的交易分钟数。
export function sessionMinute(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const clock = hours * 60 + minutes;
  if (clock >= 570 && clock <= 690) return clock - 570;
  if (clock >= 780 && clock <= 900) return clock - 660;
  return null;
}

export function createIntradayClient(options: ClientOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 6_000;

  async function getIntraday(symbol: unknown, requestedDate: unknown = beijingDate(now())): Promise<Result<IntradaySeries>> {
    const stock = resolveStock(symbol);
    if (!stock.success) return stock;
    const date = z.iso.date().safeParse(requestedDate);
    if (!date.success) return failure('INVALID_INPUT', '日期必须是有效的 YYYY-MM-DD 格式。');

    for (const [attempt, host] of hosts.entries()) {
      const url = new URL('/api/qt/stock/kline/get', host);
      url.search = new URLSearchParams({
        secid: stock.data.secid, klt: '1', fqt: '0', lmt: '1000',
        beg: date.data.replaceAll('-', ''), end: date.data.replaceAll('-', ''),
        fields1: 'f1,f2,f3,f4,f5,f6', fields2: 'f51,f52,f53,f54,f55,f56,f57',
      }).toString();
      let payload: unknown;
      try {
        const response = await fetcher(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' },
          signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (attempt === 0 && (response.status === 429 || response.status >= 500)) continue;
          return failure('UPSTREAM_HTTP_ERROR', `分钟线接口返回 HTTP ${response.status}。`);
        }
        payload = await response.json();
      } catch {
        if (attempt === 0) continue;
        return failure('UPSTREAM_UNAVAILABLE', '分钟线接口连接失败或超时，主源及备用源均不可用。');
      }
      const envelope = responseSchema.safeParse(payload);
      if (!envelope.success) return failure('UPSTREAM_INVALID_DATA', '分钟线响应格式不符合预期。');
      if (envelope.data.rc !== 0) return failure('UPSTREAM_REJECTED', `分钟线业务状态码为 ${envelope.data.rc}。`);
      if (envelope.data.data == null) return failure('NOT_FOUND', `${date.data} 未返回分钟线；可能是休市、停牌或数据暂不可用。`);
      const parsed = seriesSchema.safeParse(envelope.data.data);
      if (!parsed.success || parsed.data.code !== stock.data.code
        || parsed.data.market !== (stock.data.market === 'SH' ? 1 : 0)) {
        return failure('UPSTREAM_INVALID_DATA', '分钟线证券、市场或字段结构不匹配。');
      }
      if (parsed.data.klines.length === 0) return failure('NOT_FOUND', `${date.data} 没有可用的分钟数据。`);
      const points: MinuteBar[] = [];
      let previousTime = '';
      for (const row of parsed.data.klines) {
        const bar = minuteBarSchema.safeParse(row.split(','));
        if (!bar.success) return failure('UPSTREAM_INVALID_DATA', '分钟线包含无效数值，未绘制可能误导的曲线。');
        const [timestamp, open, close, high, low, volumeLots, turnoverYuan] = bar.data;
        const time = timestamp.slice(11);
        if (timestamp.slice(0, 10) !== date.data || sessionMinute(time) === null || time <= previousTime
          || low > Math.min(open, close) || high < Math.max(open, close) || low > high) {
          return failure('UPSTREAM_INVALID_DATA', '分钟线日期、交易时段、顺序或高低价不符合预期。');
        }
        previousTime = time;
        points.push({ time, open, close, high, low, volumeLots, turnoverYuan });
      }
      const first = points[0];
      const last = points.at(-1);
      if (!first || !last) return failure('NOT_FOUND', '没有可绘制的分钟数据。');
      return success({
        source: 'eastmoney', sourceUrl: url.toString(), fetchedAt: new Date(now()).toISOString(),
        date: date.data, timeZone: 'Asia/Shanghai', code: parsed.data.code, name: parsed.data.name,
        market: stock.data.market, decimals: parsed.data.decimal ?? (stock.data.code.startsWith('159') ? 3 : 2),
        previousClose: parsed.data.preKPrice ?? null,
        firstTime: first.time, lastTime: last.time, hasClosingBar: last.time === '15:00', points,
        notes: [
          '数据为不复权的一分钟 OHLC 线，不是全部逐笔成交；曲线使用每分钟收盘字段。',
          '盘中只能返回开盘至接口截止时间的数据；最后一根分钟线可能仍在更新。',
          'hasClosingBar 只说明存在 15:00 数据，不保证每分钟都完整；不填补或外推缺失时间。',
          '休市或停牌不自动改用上一交易日；sourceUrl 记录实际数据源，备用源可能延迟。',
        ],
      });
    }
    return failure('UPSTREAM_UNAVAILABLE', '分钟线接口不可用。');
  }
  return { getIntraday };
}
