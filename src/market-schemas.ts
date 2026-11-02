import { z } from 'zod';
import { marketSchema } from './stock.ts';

const amount = z.number().finite().nullable();
const sourceUrl = z.url().regex(/^https:\/\//);
const code = z.string().regex(/^\d{6}$/);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const fundBucketSchema = z.object({ netAmountYuan: amount, netRatioPercent: amount });
export const quoteSchema = z.object({
  code, name: z.string(), market: marketSchema,
  latestPrice: amount, change: amount, changePercent: amount, previousClose: amount,
  open: amount, high: amount, low: amount, volumeLots: amount, volumeShares: amount,
  turnoverYuan: amount, turnoverRatePercent: amount, amplitudePercent: amount,
  totalMarketCapYuan: amount, circulatingMarketCapYuan: amount,
});
export const fundFlowSchema = z.object({
  main: fundBucketSchema, superLarge: fundBucketSchema, large: fundBucketSchema,
  medium: fundBucketSchema, small: fundBucketSchema,
});
export const snapshotSchema = z.object({
  source: z.literal('eastmoney'), sourceUrl, fetchedAt: z.iso.datetime(), quoteTime: z.iso.datetime(),
  quoteTimeBeijing: z.string(), ageSeconds: z.number().nonnegative(),
  freshness: z.enum(['recent', 'older-snapshot']), quote: quoteSchema,
  fundFlow: fundFlowSchema, notes: z.array(z.string()),
});
export const minuteBarOutputSchema = z.object({
  time, open: z.number(), close: z.number(), high: z.number(), low: z.number(),
  volumeLots: z.number(), turnoverYuan: z.number(),
});
export const intradaySeriesSchema = z.object({
  source: z.literal('eastmoney'), sourceUrl, fetchedAt: z.iso.datetime(), date: z.iso.date(),
  timeZone: z.literal('Asia/Shanghai'), code, name: z.string(), market: marketSchema,
  decimals: z.number().int().min(0).max(6), previousClose: amount, firstTime: time, lastTime: time,
  hasClosingBar: z.boolean(), points: z.array(minuteBarOutputSchema).min(1).max(1000), notes: z.array(z.string()),
});

export type FundBucket = z.infer<typeof fundBucketSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type FundFlow = z.infer<typeof fundFlowSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type MinuteBar = z.infer<typeof minuteBarOutputSchema>;
export type IntradaySeries = z.infer<typeof intradaySeriesSchema>;
