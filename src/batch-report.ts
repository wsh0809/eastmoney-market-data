import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assessmentLabels } from './analysis.ts';
import type { BatchReport } from './batch.ts';
import type { LoadedConfig } from './batch-config.ts';

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
}
function number(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toFixed(digits);
}
function amount(value: number | null): string {
  return value === null ? '—' : `${(value / 10000).toFixed(2)} 万元`;
}
function percent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

export function renderBatchMarkdown(report: BatchReport): string {
  const { summary } = report;
  const beijingTime = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false,
  });
  const lines = [
    '# 股票批量行情与快照分析',
    '',
    `运行时间（北京时间）：${beijingTime.format(new Date(report.startedAt))} 至 ${beijingTime.format(new Date(report.completedAt))}`,
    '',
    `配置 ${summary.configured} 只，启用 ${summary.enabled} 只，跳过 ${summary.skipped} 只；成功 ${summary.succeeded} 只，失败 ${summary.failed} 只，较早快照 ${summary.olderSnapshots} 只。`,
    '',
    '| 代码 | 股票 | 价格（元） | 涨跌幅 | 主力净流入 | 主力净占比 | 换手率 | 行情时间（北京时间） | 快照状态 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
  ];
  for (const item of report.items) {
    if (!item.success) {
      lines.push(`| ${cell(item.stock.symbol)} | ${cell(item.stock.label ?? '—')} | — | — | — | — | — | — | 失败：${cell(item.error.message)} |`);
      continue;
    }
    const { quote, fundFlow } = item.snapshot;
    const priceDigits = quote.code.startsWith('159') ? 3 : 2;
    const label = `${assessmentLabels[item.analysis.assessment]}${item.analysis.olderThanConfiguredLimit ? '（较早快照）' : ''}`;
    lines.push(`| ${quote.code} | ${cell(quote.name)} | ${number(quote.latestPrice, priceDigits)} | ${percent(quote.changePercent)} | ${amount(fundFlow.main.netAmountYuan)} | ${percent(fundFlow.main.netRatioPercent)} | ${percent(quote.turnoverRatePercent)} | ${item.snapshot.quoteTimeBeijing} | ${label} |`);
  }
  for (const item of report.items) {
    if (!item.success) continue;
    const { quote, fundFlow } = item.snapshot;
    lines.push('', `## ${quote.code} ${cell(quote.name)}`, '');
    for (const evidence of item.analysis.evidence) lines.push(`- ${evidence}`);
    lines.push('', '| 分单 | 净流入 | 占成交额 |', '| --- | ---: | ---: |');
    for (const [label, bucket] of [
      ['超大单', fundFlow.superLarge], ['大单', fundFlow.large],
      ['中单', fundFlow.medium], ['小单', fundFlow.small], ['主力合计（超大单＋大单）', fundFlow.main],
    ] satisfies [string, typeof fundFlow.main][]) {
      lines.push(`| ${label} | ${amount(bucket.netAmountYuan)} | ${percent(bucket.netRatioPercent)} |`);
    }
    lines.push('', `[东方财富来源](${item.snapshot.sourceUrl})`);
  }
  lines.push('', '资金分单属于平台估算；主力是汇总项，不重复加总。各股票为顺序获取，时间可能不同。本报告仅分析快照，不构成对未来收益的预测。', '');
  return lines.join('\n');
}

export type ReportWriteResult =
  | { success: true; data: { directory: string; files: string[] } }
  | { success: false; error: { code: 'OUTPUT_ERROR'; message: string; writtenFiles: string[] } };

export async function writeBatchReport(report: BatchReport, loaded: LoadedConfig): Promise<ReportWriteResult> {
  const directory = resolve(loaded.directory, loaded.config.output.directory);
  const basename = `stocks-${report.startedAt.replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`;
  const files: string[] = [];
  try {
    await mkdir(directory, { recursive: true });
    for (const format of loaded.config.output.formats) {
      const path = resolve(directory, `${basename}.${format === 'json' ? 'json' : 'md'}`);
      const contents = format === 'json' ? JSON.stringify(report, null, 2) + '\n' : renderBatchMarkdown(report);
      await writeFile(path, contents, { encoding: 'utf8', flag: 'wx' });
      files.push(path);
    }
  } catch {
    return {
      success: false,
      error: { code: 'OUTPUT_ERROR', message: `无法完整保存报告，请检查目录权限和磁盘空间：${directory}`, writtenFiles: files },
    };
  }
  return { success: true, data: { directory, files } };
}
