import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { createEastmoneyClient } from '../src/eastmoney.ts';
import { createMarketMcpServer } from '../src/mcp-server.ts';
import { payloadWithRow, quoteRow } from './fixtures.ts';

describe('只读 MCP 行情工具', () => {
  it('should expose and call the tool through the MCP SDK with a validated structured result', async () => {
    const server = createMarketMcpServer(createEastmoneyClient({ fetcher: async () => Response.json(payloadWithRow()) }));
    const client = new Client({ name: 'offline-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      const tool = tools.tools.find(tool => tool.name === 'get_stock_snapshot');
      assert.ok(tool);
      assert.equal(tool.annotations?.readOnlyHint, true);
      const result = await client.callTool({ name: tool.name, arguments: { symbol: quoteRow.f12 } });
      const parsed = z.looseObject({
        isError: z.boolean(),
        structuredContent: z.looseObject({
          success: z.literal(true),
          data: z.looseObject({ quote: z.looseObject({ latestPrice: z.number() }) }),
        }),
      }).safeParse(result);
      assert.ok(parsed.success);
      assert.equal(parsed.data.isError, false);
      assert.equal(parsed.data.structuredContent.data.quote.latestPrice, quoteRow.f2);
      const invalid = await client.callTool({ name: tool.name, arguments: { symbol: 'bad' } });
      assert.equal(z.looseObject({ isError: z.literal(true) }).safeParse(invalid).success, true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('should start the actual stdio entry without corrupting stdout with application logs', async () => {
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../src/mcp.ts', import.meta.url))],
      stderr: 'pipe',
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.ok(tools.tools.some(tool => tool.name === 'get_stock_snapshot'));
      const result = await client.callTool({ name: 'get_stock_snapshot', arguments: { symbol: 'invalid' } });
      const parsed = z.looseObject({
        isError: z.literal(true),
        structuredContent: z.looseObject({
          success: z.literal(false),
          error: z.looseObject({ code: z.literal('INVALID_INPUT') }),
        }),
      }).safeParse(result);
      assert.ok(parsed.success);
    } finally {
      await client.close();
      await transport.close();
    }
  });
});
