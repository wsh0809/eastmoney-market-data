import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createMarketMcpServer } from './mcp-server.ts';

// stdout 专供 MCP JSON-RPC，诊断日志只能写到 stderr。
await serveStdio(() => createMarketMcpServer());
