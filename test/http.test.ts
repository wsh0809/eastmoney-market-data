import assert from 'node:assert/strict';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { createEastmoneyClient } from '../src/eastmoney.ts';
import { createHttpServer } from '../src/http-server.ts';
import { payloadWithRow, quoteRow } from './fixtures.ts';

const bodySchema = z.looseObject({ success: z.boolean(), data: z.unknown().nullish() });

describe('HTTP 行情服务', () => {
  it('should route requests, validate inputs and keep quote and flow in one upstream snapshot', async () => {
    let calls = 0;
    const server = createHttpServer(createEastmoneyClient({ fetcher: async () => {
      calls++;
      return Response.json(payloadWithRow());
    } }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      assert.equal((await fetch(`${base}/health`)).status, 200);
      assert.equal((await fetch(`${base}/api/quote`)).status, 400);
      assert.equal((await fetch(`${base}/api/quote?symbol=600127&symbol=000001`)).status, 400);
      assert.equal((await fetch(`${base}/api/quote?symbol=bad`)).status, 400);
      assert.equal((await fetch(`${base}/missing`)).status, 404);
      const method = await fetch(`${base}/api/quote?symbol=600127`, { method: 'POST' });
      assert.equal(method.status, 405);
      assert.equal(method.headers.get('allow'), 'GET');
      assert.equal(calls, 0);
      const response = await fetch(`${base}/api/snapshot?symbol=${quoteRow.f12}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body: unknown = await response.json();
      const parsed = bodySchema.safeParse(body);
      assert.ok(parsed.success);
      assert.equal(parsed.data.success, true);
      const data = z.looseObject({
        quote: z.looseObject({ code: z.string() }),
        fundFlow: z.looseObject({ main: z.looseObject({ netAmountYuan: z.number() }) }),
      }).safeParse(parsed.data.data);
      assert.ok(data.success);
      assert.equal(data.data.quote.code, quoteRow.f12);
      assert.equal(data.data.fundFlow.main.netAmountYuan, quoteRow.f62);
      assert.equal(calls, 1);
      for (const route of ['quote', 'fund-flow']) {
        assert.equal((await fetch(`${base}/api/${route}?symbol=${quoteRow.f12}`)).status, 200);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
