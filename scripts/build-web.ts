import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

try {
  await build({
    entryPoints: [fileURLToPath(new URL('../src/web/browser.ts', import.meta.url))],
    outfile: fileURLToPath(new URL('../public/dashboard.js', import.meta.url)),
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true,
    logLevel: 'info',
  });
} catch {
  console.error('Web 页面构建失败，请检查依赖及上方诊断。');
  process.exitCode = 1;
}
