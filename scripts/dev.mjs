import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Hard Node version gate. Keep local dev aligned with Vercel's Node 22 runtime
 * (engines.node = 22.x). Fail fast at `npm run dev` instead of hitting a
 * confusing version drift at deploy time.
 */
const major = Number(process.versions.node.split('.')[0]);
if (major !== 22) {
  console.error(
    `本项目需要 Node 22（当前 Node ${process.versions.node}），请用 nvm use 切换，与 Vercel 运行时保持一致。`,
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const child = spawn(process.execPath, [nextBin, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
