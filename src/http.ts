import { z } from 'zod';
import { createHttpServer } from './http-server.ts';

const configuration = z.object({
  port: z.coerce.number().int().min(1).max(65535),
}).safeParse({ port: process.env['PORT'] ?? 3000 });

if (!configuration.success) {
  console.error('PORT 必须是 1—65535 之间的整数。');
  process.exitCode = 1;
} else {
  const server = createHttpServer();
  server.on('error', (error: Error) => {
    console.error(`HTTP 服务启动失败：${error.message}`);
    process.exitCode = 1;
  });
  server.listen(configuration.data.port, '127.0.0.1', () => {
    console.log(`东方财富行情服务：http://127.0.0.1:${configuration.data.port}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close());
  }
}
