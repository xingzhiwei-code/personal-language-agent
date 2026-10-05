import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Hard Node version gate (v0.3 §P3). `better-sqlite3` fails with an ABI
 * mismatch on Node 24, which surfaces as a confusing 500 on the knowledge page.
 * We fail fast at `npm run dev` instead.
 */
const major = Number(process.versions.node.split('.')[0]);
if (major !== 20) {
  console.error(
    `本项目需要 Node 20（当前 Node ${process.versions.node}），请用 nvm use 切换。better-sqlite3 在 Node 24 下无法工作。`,
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
