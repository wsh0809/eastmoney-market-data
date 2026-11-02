import { createEastmoneyClient } from './eastmoney.ts';
import { failure } from './result.ts';

const [command = 'help', symbol, ...extra] = process.argv.slice(2);

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`东方财富 A 股公开行情查询（Node.js 24）

用法：
  npm run quote -- 600127       行情
  npm run funds -- 600127       资金分布
  npm run snapshot -- 600127    行情及资金完整快照
  npm run batch                按 config/stocks.json 批量获取并分析
  npm run intraday -- 600127    今天的一分钟 OHLC 序列
  npm run chart                启动 Web 行情页面，每 30 秒刷新
  npm run chart:export         导出今天的静态日内价格图
  npm start                    启动本地 HTTP 服务
  npm run mcp                  启动 stdio MCP 服务

代码支持：600127、SH600127、600127.SH；自动识别沪深京 A 股和 159 开头的深市 ETF。`);
} else if (!['quote', 'funds', 'snapshot'].includes(command) || extra.length > 0) {
  console.error(JSON.stringify(failure('INVALID_INPUT', '命令无效，请运行 node src/cli.ts --help。'), null, 2));
  process.exitCode = 1;
} else {
  const result = await createEastmoneyClient().getSnapshot(symbol);
  if (!result.success) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    const { quote, fundFlow, ...metadata } = result.data;
    const data = command === 'quote' ? { ...metadata, quote }
      : command === 'funds' ? { ...metadata, code: quote.code, name: quote.name, fundFlow }
      : result.data;
    console.log(JSON.stringify({ success: true, data }, null, 2));
  }
}
