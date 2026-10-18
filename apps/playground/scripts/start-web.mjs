import { spawn } from 'node:child_process';

// Expo 57 rejects --no-open; its supported BROWSER=none option has the same effect.
const child = spawn(
  'expo',
  ['start', '--web', '--lan', '--port', '5266', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, BROWSER: 'none' },
  }
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
