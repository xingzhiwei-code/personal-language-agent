import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Hard Node version gate. The native SQLite driver has been removed, but we
 * keep the gate to stay aligned with Vercel's Node 20 runtime
 * (engines.node = 20.x). Fail fast at `npm run dev` instead of hitting a
 * confusing version drift at deploy time.
 */
const major = Number(process.versions.node.split('.')[0]);
if (major !== 20) {
  console.error(
    `本项目需要 Node 20（当前 Node ${process.versions.node}），请用 nvm use 切换，与 Vercel 运行时保持一致。`,
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
