import { fileURLToPath } from 'node:url';
import { runBatch } from './batch.ts';
import { loadBatchConfig } from './batch-config.ts';
import { writeBatchReport } from './batch-report.ts';
import { createEastmoneyClient } from './eastmoney.ts';

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0] ?? '')) {
  console.log(`用法：
  npm run batch
  npm run batch -- --config /path/to/stocks.json

默认读取项目 config/stocks.json；逐只获取并按阈值分析，输出 JSON/Markdown 报告。
退出码：0=全部成功；1=配置或输出失败；2=部分或全部股票查询失败（仍保存报告）。`);
} else if (args.length !== 0 && !(args.length === 2 && args[0] === '--config' && args[1])) {
  console.error('参数无效，请运行 npm run batch -- --help。');
  process.exitCode = 1;
} else {
  const path = args[1] ?? fileURLToPath(new URL('../config/stocks.json', import.meta.url));
  const loaded = await loadBatchConfig(path);
  if (!loaded.success) {
    console.error(JSON.stringify(loaded, null, 2));
    process.exitCode = 1;
  } else {
    const report = await runBatch(loaded.data.config, createEastmoneyClient());
    const output = await writeBatchReport(report, loaded.data);
    if (!output.success) {
      console.error(JSON.stringify(output, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({
        success: report.summary.failed === 0,
        summary: report.summary,
        configPath: loaded.data.path,
        files: output.data.files,
      }, null, 2));
      if (report.summary.failed > 0) process.exitCode = 2;
    }
  }
}
