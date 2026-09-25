const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');

const [mode, statePath] = process.argv.slice(2);

if (mode === 'grandchild') {
  process.on('SIGTERM', () => {});
  writeFileSync(statePath, JSON.stringify({ parentPid: process.ppid, grandchildPid: process.pid }));
} else if (mode === 'direct') {
  process.on('SIGTERM', () => {});
  writeFileSync(statePath, JSON.stringify({ parentPid: process.pid }));
} else if (mode === 'tree') {
  spawn(process.execPath, [__filename, 'grandchild', statePath], { stdio: 'ignore' });
} else if (mode === 'overflow') {
  writeFileSync(statePath, JSON.stringify({ parentPid: process.pid }));
  const chunk = Buffer.alloc(1024 * 1024, 97);
  const write = () => {
    while (process.stdout.write(chunk)) continue;
    process.stdout.once('drain', write);
  };
  write();
} else {
  process.exit(2);
}

setInterval(() => {}, 1_000);
