import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { analyzeSnapshot, assessmentLabels } from './analysis.ts';
import { loadBatchConfig } from './batch-config.ts';
import type { ConfigLoadResult, LoadedConfig } from './batch-config.ts';
import { DASHBOARD_REFRESH_MS } from './dashboard-schema.ts';
import type { DashboardData, DashboardItem, DashboardResponse } from './dashboard-schema.ts';
import { createEastmoneyClient } from './eastmoney.ts';
import type { EastmoneyClient, Snapshot } from './eastmoney.ts';
import { beijingDate, createIntradayClient } from './intraday.ts';

type DashboardOptions = {
  snapshotClient?: EastmoneyClient;
  intradayClient?: ReturnType<typeof createIntradayClient>;
  readConfig?: () => Promise<ConfigLoadResult>;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
};

export function createDashboardService(options: DashboardOptions = {}) {
  const snapshotClient = options.snapshotClient ?? createEastmoneyClient({ timeoutMs: 3000 });
  const intradayClient = options.intradayClient ?? createIntradayClient({ timeoutMs: 3000 });
  const readConfig = options.readConfig ?? (() => loadBatchConfig(fileURLToPath(new URL('../config/stocks.json', import.meta.url))));
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (async milliseconds => { await delay(milliseconds); });
  let cached: DashboardData | null = null;
  let cacheKey = '';
  let startedAtMs = -Infinity;
  let inFlight: Promise<DashboardResponse> | null = null;

  function ageSnapshot(snapshot: Snapshot | null): Snapshot | null {
    if (!snapshot) return null;
    const ageSeconds = Math.max(0, Math.floor((now() - Date.parse(snapshot.quoteTime)) / 1000));
    return { ...snapshot, ageSeconds, freshness: ageSeconds <= 60 ? 'recent' : 'older-snapshot' };
  }

  async function refresh(loaded: LoadedConfig, date: string): Promise<DashboardResponse> {
    const stocks = loaded.config.stocks.filter(stock => stock.enabled);
    const previous = new Map(cached?.items.map(item => [item.stock.symbol, item]));
    const items: DashboardItem[] = [];
    let cursor = 0;
    let nextStartAt = now();
    const startedAt = new Date(startedAtMs).toISOString();
    async function worker(): Promise<void> {
      while (cursor < stocks.length) {
        const index = cursor++;
        const stock = stocks[index];
        if (!stock) continue;
        const scheduledAt = Math.max(now(), nextStartAt);
        nextStartAt = scheduledAt + loaded.config.request.intervalMs;
        if (scheduledAt > now()) await wait(scheduledAt - now());
        const [snapshotResult, intradayResult] = await Promise.all([
          snapshotClient.getSnapshot(stock.symbol), intradayClient.getIntraday(stock.symbol, date),
        ]);
        const old = previous.get(stock.symbol);
        const oldSnapshot = old?.snapshot && beijingDate(Date.parse(old.snapshot.quoteTime)) === date ? old.snapshot : null;
        const oldIntraday = old?.intraday?.date === date ? old.intraday : null;
        const snapshot = ageSnapshot(snapshotResult.success ? snapshotResult.data : oldSnapshot);
        const intraday = intradayResult.success ? intradayResult.data : oldIntraday;
        const analysis = snapshot ? analyzeSnapshot(snapshot, loaded.config.analysis) : null;
        items[index] = {
          stock, snapshot, snapshotError: snapshotResult.success ? null : snapshotResult.error,
          snapshotRetained: !snapshotResult.success && snapshot !== null,
          intraday, intradayError: intradayResult.success ? null : intradayResult.error,
          intradayRetained: !intradayResult.success && intraday !== null,
          analysis: analysis ? { label: assessmentLabels[analysis.assessment], evidence: analysis.evidence } : null,
        };
      }
    }
    await Promise.all([worker(), worker()]);
    const data: DashboardData = {
      date, startedAt, completedAt: new Date(now()).toISOString(), refreshIntervalMs: DASHBOARD_REFRESH_MS,
      summary: { total: items.length, snapshots: items.filter(item => item.snapshot !== null).length,
        charts: items.filter(item => item.intraday !== null).length,
        failed: items.filter(item => item.snapshotError !== null || item.intradayError !== null).length },
      items,
    };
    cached = data;
    return { success: true, data };
  }

  async function getDashboard(force = false): Promise<DashboardResponse> {
    const loaded = await readConfig();
    if (!loaded.success) return loaded;
    const date = beijingDate(now());
    const key = JSON.stringify(loaded.data.config);
    if (inFlight) {
      const result = await inFlight;
      if (key === cacheKey && cached?.date === date) return result;
      return getDashboard(force);
    }
    const interval = force ? 5000 : DASHBOARD_REFRESH_MS;
    if (cached && key === cacheKey && cached.date === date && now() - startedAtMs < interval) {
      return { success: true, data: cached };
    }
    cacheKey = key;
    startedAtMs = now();
    inFlight = refresh(loaded.data, date);
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }
  return { getDashboard, readConfig };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
