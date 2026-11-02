import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createEastmoneyClient } from './eastmoney.ts';
import type { EastmoneyClient } from './eastmoney.ts';
import { stockSymbolSchema } from './stock.ts';

export function createMarketMcpServer(client: EastmoneyClient = createEastmoneyClient()) {
  const server = new McpServer({ name: 'eastmoney-market-data', version: '0.1.0' });

  server.registerTool('get_stock_snapshot', {
    title: '查询 A 股及深市 ETF 行情和资金分布',
    description: '读取东方财富公开快照：股票价格、成交额、超大单/大单/中单/小单净流向。必须检查 quoteTime 和 ageSeconds；不保证交易所实时性，休市返回最近快照。',
    inputSchema: z.object({ symbol: stockSymbolSchema.describe('六位 A 股或 159 开头的深市 ETF 代码，如 600127、600127.SH、159502.SZ') }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ symbol }) => {
    const result = await client.getSnapshot(symbol);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: { ...result },
      isError: !result.success,
    };
  });
  return server;
}
