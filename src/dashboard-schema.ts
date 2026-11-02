import { z } from 'zod';
import { intradaySeriesSchema, snapshotSchema } from './market-schemas.ts';
import { marketSchema } from './stock.ts';

export const DASHBOARD_REFRESH_MS = 30_000;
export const publicStockSchema = z.looseObject({
  symbol: z.string(), label: z.string().nullish(),
  basicInfo: z.looseObject({
    name: z.string(), market: marketSchema, securityType: z.enum(['stock', 'etf']), industry: z.string().nullish(),
  }).nullish(),
});
const errorSchema = z.object({ code: z.string(), message: z.string() });
export const dashboardItemSchema = z.object({
  stock: publicStockSchema,
  snapshot: snapshotSchema.nullable(), snapshotError: errorSchema.nullable(), snapshotRetained: z.boolean(),
  intraday: intradaySeriesSchema.nullable(), intradayError: errorSchema.nullable(), intradayRetained: z.boolean(),
  analysis: z.object({ label: z.string(), evidence: z.array(z.string()) }).nullable(),
});
export const dashboardDataSchema = z.object({
  date: z.iso.date(), startedAt: z.iso.datetime(), completedAt: z.iso.datetime(),
  refreshIntervalMs: z.literal(DASHBOARD_REFRESH_MS),
  summary: z.object({ total: z.number(), snapshots: z.number(), charts: z.number(), failed: z.number() }),
  items: z.array(dashboardItemSchema),
});
export const dashboardResponseSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: dashboardDataSchema }),
  z.object({ success: z.literal(false), error: errorSchema }),
]);
export type PublicStock = z.infer<typeof publicStockSchema>;
export type DashboardItem = z.infer<typeof dashboardItemSchema>;
export type DashboardData = z.infer<typeof dashboardDataSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
