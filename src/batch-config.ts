import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { marketSchema, resolveStock, stockSymbolSchema } from './stock.ts';

const basicInfoSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  market: marketSchema,
  securityType: z.enum(['stock', 'etf']),
  industry: z.string().trim().min(1).nullish(),
  source: z.literal('eastmoney'),
  fetchedAt: z.iso.datetime(),
});

const configuredStockSchema = z.strictObject({
  symbol: stockSymbolSchema,
  label: z.string().trim().min(1).max(100).nullish(),
  enabled: z.boolean().default(true),
  basicInfo: basicInfoSchema.nullish(),
});

export const batchConfigSchema = z.strictObject({
  $schema: z.string().nullish(),
  stocks: z.array(configuredStockSchema).min(1).max(100),
  request: z.strictObject({
    intervalMs: z.number().int().min(500).max(60_000).default(1000),
  }).prefault({}),
  analysis: z.strictObject({
    priceChangeThresholdPercent: z.number().positive().max(100).default(3),
    mainFlowThresholdPercent: z.number().positive().max(100).default(5),
    highTurnoverThresholdPercent: z.number().positive().max(1000).default(10),
    maxSnapshotAgeSeconds: z.number().int().nonnegative().max(604_800).default(180),
  }).prefault({}),
  output: z.strictObject({
    directory: z.string().trim().min(1).default('../reports'),
    formats: z.array(z.enum(['json', 'markdown'])).min(1).refine(
      formats => new Set(formats).size === formats.length,
      '输出格式不能重复。',
    ).default(['json', 'markdown']),
  }).prefault({}),
}).superRefine((config, context) => {
  const seen = new Set<string>();
  let enabledCount = 0;
  for (const [index, entry] of config.stocks.entries()) {
    const stock = resolveStock(entry.symbol);
    if (!stock.success) {
      context.addIssue({ code: 'custom', path: ['stocks', index, 'symbol'], message: stock.error.message });
      continue;
    }
    if (entry.basicInfo) {
      if (entry.basicInfo.market !== stock.data.market) {
        context.addIssue({ code: 'custom', path: ['stocks', index, 'basicInfo', 'market'], message: '基础信息中的市场与证券代码不匹配。' });
      }
      const securityType = stock.data.code.startsWith('159') ? 'etf' : 'stock';
      if (entry.basicInfo.securityType !== securityType) {
        context.addIssue({ code: 'custom', path: ['stocks', index, 'basicInfo', 'securityType'], message: '基础信息中的证券类型与代码不匹配。' });
      }
    }
    if (!entry.enabled) continue;
    enabledCount++;
    if (seen.has(stock.data.secid)) {
      context.addIssue({ code: 'custom', path: ['stocks', index, 'symbol'], message: '启用的股票代码重复。' });
    }
    seen.add(stock.data.secid);
  }
  if (enabledCount === 0) {
    context.addIssue({ code: 'custom', path: ['stocks'], message: '至少需要启用一只有效股票。' });
  }
});

export type BatchConfig = z.infer<typeof batchConfigSchema>;
export type ConfiguredStock = z.infer<typeof configuredStockSchema>;
export type AnalysisSettings = BatchConfig['analysis'];
export type LoadedConfig = { path: string; directory: string; config: BatchConfig };
export type ConfigLoadResult =
  | { success: true; data: LoadedConfig }
  | { success: false; error: { code: 'CONFIG_ERROR'; message: string } };

export async function loadBatchConfig(path: string): Promise<ConfigLoadResult> {
  const absolutePath = resolve(path);
  let content: string;
  try {
    content = await readFile(absolutePath, 'utf8');
  } catch {
    return configError(`无法读取配置文件：${absolutePath}`);
  }
  let input: unknown;
  try {
    input = JSON.parse(content);
  } catch {
    return configError(`配置文件不是有效的 JSON：${absolutePath}`);
  }
  const parsed = batchConfigSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map(issue => `${issue.path.join('.') || 'config'}: ${issue.message}`);
    return configError(`配置校验失败：\n${details.join('\n')}`);
  }
  return { success: true, data: { path: absolutePath, directory: dirname(absolutePath), config: parsed.data } };
}

function configError(message: string): ConfigLoadResult {
  return { success: false, error: { code: 'CONFIG_ERROR', message } };
}
