import { setTimeout as delay } from 'node:timers/promises';
import { analyzeSnapshot } from './analysis.ts';
import type { SnapshotAnalysis } from './analysis.ts';
import type { BatchConfig, ConfiguredStock } from './batch-config.ts';
import type { EastmoneyClient, Snapshot } from './eastmoney.ts';
import type { Failure } from './result.ts';

export type BatchItem =
  | { success: true; stock: ConfiguredStock; snapshot: Snapshot; analysis: SnapshotAnalysis }
  | { success: false; stock: ConfiguredStock; error: Failure['error'] };
export type BatchReport = {
  startedAt: string;
  completedAt: string;
  settings: BatchConfig;
  summary: { configured: number; enabled: number; skipped: number; succeeded: number; failed: number; olderSnapshots: number };
  items: BatchItem[];
};
export type BatchOptions = {
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
};

export async function runBatch(
  config: BatchConfig,
  client: EastmoneyClient,
  options: BatchOptions = {},
): Promise<BatchReport> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (async milliseconds => { await delay(milliseconds); });
  const startedAt = new Date(now()).toISOString();
  const enabled = config.stocks.filter(stock => stock.enabled);
  const items: BatchItem[] = [];

  for (const [index, stock] of enabled.entries()) {
    // 顺序查询；前一只完成后至少等待配置间隔，避免瞬时并发请求。
    if (index > 0) await wait(config.request.intervalMs);
    const result = await client.getSnapshot(stock.symbol);
    if (!result.success) {
      items.push({ success: false, stock, error: result.error });
      continue;
    }
    items.push({ success: true, stock, snapshot: result.data, analysis: analyzeSnapshot(result.data, config.analysis) });
  }

  const succeeded = items.filter(item => item.success).length;
  return {
    startedAt,
    completedAt: new Date(now()).toISOString(),
    settings: config,
    summary: {
      configured: config.stocks.length,
      enabled: enabled.length,
      skipped: config.stocks.length - enabled.length,
      succeeded,
      failed: items.length - succeeded,
      olderSnapshots: items.filter(item => item.success && item.analysis.olderThanConfiguredLimit).length,
    },
    items,
  };
}
