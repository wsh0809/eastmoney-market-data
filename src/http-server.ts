import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createDashboardService } from './dashboard.ts';
import type { DashboardService } from './dashboard.ts';
import { renderDashboardPage } from './dashboard-page.ts';
import { createEastmoneyClient } from './eastmoney.ts';
import type { EastmoneyClient } from './eastmoney.ts';
import { failure } from './result.ts';
import type { ErrorCode } from './result.ts';

const statusByCode: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  UPSTREAM_UNAVAILABLE: 503,
  UPSTREAM_HTTP_ERROR: 502,
  UPSTREAM_REJECTED: 502,
  UPSTREAM_INVALID_DATA: 502,
};
const routes = new Set(['/api/quote', '/api/fund-flow', '/api/snapshot']);

export function createHttpServer(client: EastmoneyClient = createEastmoneyClient(), dashboard: DashboardService = createDashboardService()) {
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(JSON.stringify(body));
    };

    async function handle() {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        send(405, failure('INVALID_INPUT', '仅支持 GET 请求。'));
        return;
      }
      // 固定 base，客户端无法用 Host 请求头改变上游目标。
      const url = URL.parse(request.url ?? '/', 'http://127.0.0.1');
      if (!url) {
        send(400, failure('INVALID_INPUT', '请求地址无效。'));
        return;
      }
      if (url.pathname === '/') {
        const loaded = await dashboard.readConfig();
        const html = renderDashboardPage(loaded.success ? loaded.data.config.stocks.filter(stock => stock.enabled) : [],
          loaded.success ? null : loaded.error.message);
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        });
        response.end(html);
        return;
      }
      if (url.pathname === '/assets/dashboard.js' || url.pathname === '/assets/dashboard.css') {
        const isScript = url.pathname.endsWith('.js');
        try {
          const content = await readFile(new URL(isScript ? '../public/dashboard.js' : '../public/dashboard.css', import.meta.url));
          response.writeHead(200, { 'Content-Type': isScript ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
            'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
          response.end(content);
        } catch {
          send(503, { success: false, error: { code: 'ASSET_UNAVAILABLE', message: '页面资源缺失，请运行 npm run web:build。' } });
        }
        return;
      }
      if (url.pathname === '/api/dashboard') {
        const result = await dashboard.getDashboard(url.searchParams.get('refresh') === '1');
        send(result.success ? 200 : 500, result);
        return;
      }
      if (url.pathname === '/health') {
        send(200, { success: true, data: { status: 'ok', service: 'eastmoney-market-data' } });
        return;
      }
      if (!routes.has(url.pathname)) {
        send(404, failure('NOT_FOUND', '可用路径：/、/health、/api/dashboard、/api/quote、/api/fund-flow、/api/snapshot。'));
        return;
      }
      if (url.searchParams.getAll('symbol').length !== 1) {
        send(400, failure('INVALID_INPUT', '请提供且仅提供一个 symbol 参数，例如 ?symbol=600127。'));
        return;
      }
      const result = await client.getSnapshot(url.searchParams.get('symbol'));
      if (!result.success) {
        send(statusByCode[result.error.code], result);
        return;
      }
      const { quote, fundFlow, ...metadata } = result.data;
      const data = url.pathname === '/api/quote' ? { ...metadata, quote }
        : url.pathname === '/api/fund-flow' ? { ...metadata, code: quote.code, name: quote.name, fundFlow }
        : result.data;
      send(200, { success: true, data });
    }

    // 捕获 HTTP 回调中的未预期异常，防止未处理的 Promise 拒绝终止服务。
    void handle().catch((error: unknown) => {
      console.error('Unexpected HTTP handler error:', error);
      if (!response.headersSent) send(500, { success: false, error: { code: 'INTERNAL_ERROR', message: '服务内部错误。' } });
      else response.destroy();
    });
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  return server;
}
