import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { batchConfigSchema } from '../src/batch-config.ts';

try {
  const schema = z.toJSONSchema(batchConfigSchema, { io: 'input' });
  await writeFile(new URL('../config/stocks.schema.json', import.meta.url), JSON.stringify(schema, null, 2) + '\n');
  console.log('已更新 config/stocks.schema.json。');
} catch {
  console.error('配置 JSON Schema 生成失败，请检查目标目录权限。');
  process.exitCode = 1;
}
