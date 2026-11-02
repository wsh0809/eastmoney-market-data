import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { loadBatchConfig } from './batch-config.ts';
import { beijingDate, createIntradayClient, sessionMinute } from './intraday.ts';
import { escapeHtml, renderChartHtml, renderIntradaySvg } from './intraday-chart.ts';
import type { ChartItem } from './intraday-chart.ts';

const [command, symbol, ...extra] = process.argv.slice(2);
const client = createIntradayClient();

async function main(): Promise<void> {
  if (symbol === '--help' || symbol === '-h') {
    console.log('npm run intraday -- 600127：输出今天的分钟线 JSON\nnpm run chart:export -- 600127：导出单只证券日内图\nnpm run chart:export：导出全部启用证券的日内图\nnpm run chart：启动每 30 秒刷新的 Web 页面');
    return;
  }
  if (!['data', 'chart'].includes(command ?? '') || extra.length > 0 || (command === 'data' && !symbol)) {
    console.error('参数错误，运行 npm run chart:export -- --help 查看用法。');
    process.exitCode = 1;
    return;
  }
  if (command === 'data') {
    const result = await client.getIntraday(symbol);
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exitCode = 1;
    return;
  }
  const loaded = await loadBatchConfig(fileURLToPath(new URL('../config/stocks.json', import.meta.url)));
  if (!loaded.success) {
    console.error(JSON.stringify(loaded, null, 2));
    process.exitCode = 1;
    return;
  }
  const symbols = symbol ? [symbol] : loaded.data.config.stocks.filter(stock => stock.enabled).map(stock => stock.symbol);
  const date = beijingDate();
  const items: ChartItem[] = [];
  for (const [index, code] of symbols.entries()) {
    if (index > 0) await delay(loaded.data.config.request.intervalMs);
    const result = await client.getIntraday(code, date);
    items.push(result.success ? { symbol: code, success: true, series: result.data }
      : { symbol: code, success: false, error: result.error });
  }
  const directory = resolve(loaded.data.directory, loaded.data.config.output.directory,
    `charts-${date}-${randomUUID().slice(0, 8)}`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'data.json'), JSON.stringify({ date, items }, null, 2), { flag: 'wx' });
    for (const item of items) {
      if (!item.success) continue;
      await writeFile(resolve(directory, `${item.series.code}.svg`), renderIntradaySvg(item.series), { flag: 'wx' });
    }
    // 内置模块处理本项目的受控源码；不运行或编译外部输入。
    const renderer = stripTypeScriptTypes(`${escapeHtml.toString()}\n${sessionMinute.toString()}\n${renderIntradaySvg.toString()}`, { mode: 'strip' });
    await writeFile(resolve(directory, 'index.html'), renderChartHtml(items, date, renderer), { flag: 'wx' });
  } catch (error) {
    console.error('图表保存失败：', error instanceof Error ? error.message : '请检查目录权限和磁盘空间。');
    process.exitCode = 1;
    return;
  }
  const succeeded = items.filter(item => item.success).length;
  console.log(JSON.stringify({ success: succeeded === items.length, date, succeeded, failed: items.length - succeeded,
    directory, chart: resolve(directory, 'index.html') }, null, 2));
  if (succeeded !== items.length) process.exitCode = 2;
}

await main();
