import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { failure, success } from './result.ts';
import type { Failure, Result } from './result.ts';
import { resolveStock } from './stock.ts';
import type { Stock } from './stock.ts';
import type { Snapshot } from './market-schemas.ts';
export type { FundBucket, Quote, FundFlow, Snapshot } from './market-schemas.ts';

const numericField = z.union([z.number().finite(), z.literal('-')]).nullish();
const quoteRowSchema = z.looseObject({
  f2: numericField, f3: numericField, f4: numericField,
  f5: numericField, f6: numericField, f7: numericField, f8: numericField,
  f12: z.string().regex(/^\d{6}$/), f14: z.string().min(1),
  f15: numericField, f16: numericField, f17: numericField, f18: numericField,
  f20: numericField, f21: numericField,
  f62: numericField, f66: numericField, f69: numericField,
  f72: numericField, f75: numericField, f78: numericField,
  f81: numericField, f84: numericField, f87: numericField,
  f124: z.number().int().positive().max(253402300799),
});
const envelopeSchema = z.looseObject({
  rc: z.number().int(),
  data: z.unknown().nullish(),
});
const rowsSchema = z.looseObject({ diff: z.array(z.unknown()) });

const fields = Object.keys(quoteRowSchema.shape).join(',');
const endpoints = [
  'https://push2.eastmoney.com/api/qt/ulist.np/get',
  'https://push2delay.eastmoney.com/api/qt/ulist.np/get',
];

export type ClientOptions = {
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  retryDelayMs?: number;
};

function numeric(value: z.infer<typeof numericField>): number | null {
  return typeof value === 'number' ? value : null;
}

function ratio(amount: number | null, turnover: number | null): number | null {
  return amount !== null && turnover !== null && turnover > 0 ? amount / turnover * 100 : null;
}

export function createEastmoneyClient(options: ClientOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const retryDelayMs = options.retryDelayMs ?? 300;

  async function request(stock: Stock): Promise<Result<{ payload: unknown; url: string }>> {
    for (const [attempt, endpoint] of endpoints.entries()) {
      const url = new URL(endpoint);
      url.searchParams.set('fltt', '2'); // 价格已经缩放为元，不再除以 100。
      url.searchParams.set('secids', stock.secid);
      url.searchParams.set('fields', fields);
      if (attempt > 0) await delay(retryDelayMs);
      try {
        const response = await fetcher(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel();
          if ((response.status === 429 || response.status >= 500) && attempt === 0) continue;
          return failure('UPSTREAM_HTTP_ERROR', `东方财富返回 HTTP ${response.status}，请稍后重试。`);
        }
        // fetch/json 是第三方 I/O 边界；运行时内容在下一步由 Zod 验证。
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return failure('UPSTREAM_INVALID_DATA', '东方财富返回了非 JSON 数据，可能是接口变更或访问限制。');
        }
        return success({ payload, url: url.toString() });
      } catch (error) {
        if (attempt === 1) {
          const cause = error instanceof Error ? z.looseObject({ code: z.string().nullish() }).safeParse(error.cause) : null;
          const reason = error instanceof Error && error.name === 'TimeoutError' ? '请求超时'
            : cause?.success && cause.data.code ? `连接失败（${cause.data.code}）` : '连接失败';
          return failure('UPSTREAM_UNAVAILABLE', `东方财富主源及备用源${reason}，请稍后重试。`);
        }
      }
    }
    return failure('UPSTREAM_UNAVAILABLE', '东方财富暂时不可用。');
  }

  async function getSnapshot(symbol: unknown): Promise<Result<Snapshot>> {
    const stock = resolveStock(symbol);
    if (!stock.success) return stock;

    const response = await request(stock.data);
    if (!response.success) return response;
    const envelope = envelopeSchema.safeParse(response.data.payload);
    if (!envelope.success) return invalidData();
    if (envelope.data.rc !== 0) {
      return failure('UPSTREAM_REJECTED', `东方财富拒绝本次查询，业务状态码为 ${envelope.data.rc}。`);
    }
    if (envelope.data.data == null) return failure('NOT_FOUND', '未找到该股票的行情数据。');
    const rows = rowsSchema.safeParse(envelope.data.data);
    if (!rows.success) return invalidData();
    if (rows.data.diff.length === 0) return failure('NOT_FOUND', '未找到该股票的行情数据。');
    if (rows.data.diff.length !== 1) return invalidData();
    const parsed = quoteRowSchema.safeParse(rows.data.diff[0]);
    if (!parsed.success || parsed.data.f12 !== stock.data.code) return invalidData();
    const row = parsed.data;
    const fetchedAtMs = now();
    const quoteTimeMs = row.f124 * 1_000;
    const ageSeconds = Math.max(0, Math.floor((fetchedAtMs - quoteTimeMs) / 1_000));
    const quoteDate = new Date(quoteTimeMs);
    const turnover = numeric(row.f6);
    const main = numeric(row.f62);
    const volumeLots = numeric(row.f5);

    return success({
      source: 'eastmoney',
      sourceUrl: response.data.url,
      fetchedAt: new Date(fetchedAtMs).toISOString(),
      quoteTime: quoteDate.toISOString(),
      quoteTimeBeijing: new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false,
      }).format(quoteDate) + ' +08:00',
      ageSeconds,
      freshness: ageSeconds <= 60 ? 'recent' : 'older-snapshot',
      quote: {
        code: row.f12,
        name: row.f14,
        market: stock.data.market,
        latestPrice: numeric(row.f2),
        change: numeric(row.f4),
        changePercent: numeric(row.f3),
        previousClose: numeric(row.f18),
        open: numeric(row.f17),
        high: numeric(row.f15),
        low: numeric(row.f16),
        volumeLots,
        volumeShares: volumeLots === null ? null : volumeLots * 100,
        turnoverYuan: turnover,
        turnoverRatePercent: numeric(row.f8),
        amplitudePercent: numeric(row.f7),
        totalMarketCapYuan: numeric(row.f20),
        circulatingMarketCapYuan: numeric(row.f21),
      },
      fundFlow: {
        main: { netAmountYuan: main, netRatioPercent: ratio(main, turnover) },
        superLarge: { netAmountYuan: numeric(row.f66), netRatioPercent: numeric(row.f69) },
        large: { netAmountYuan: numeric(row.f72), netRatioPercent: numeric(row.f75) },
        medium: { netAmountYuan: numeric(row.f78), netRatioPercent: numeric(row.f81) },
        small: { netAmountYuan: numeric(row.f84), netRatioPercent: numeric(row.f87) },
      },
      notes: [
        '公开接口快照，以 quoteTime 为准；recent 仅表示时间差不超过 60 秒，不保证交易所级实时性。',
        '主源失败时回退东方财富公开备用源；实际来源见 sourceUrl，备用源可能有延迟。',
        '休市、停牌或接口延迟时可能返回较早快照；older-snapshot 不等于接口故障。',
        '金额单位为人民币元，价格单位为元，百分数字段 2.73 表示 2.73%，成交量每手按 100 股换算。',
        '主力等于超大单加大单，不应重复加总；资金分类为平台估算，不代表真实投资者身份或持仓。',
        '缺失值和上游占位符 - 返回 null，不当作 0。上游字段之间可能有刷新时差或舍入差异。',
      ],
    });
  }

  return { getSnapshot };
}

function invalidData(): Failure {
  return failure('UPSTREAM_INVALID_DATA', '东方财富返回的数据结构、股票代码或行情时间不符合预期。');
}

export type EastmoneyClient = ReturnType<typeof createEastmoneyClient>;
