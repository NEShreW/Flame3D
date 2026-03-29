const { spawnSync } = require('child_process');

const filePath = process.argv[2] || 'main.js';

const result = spawnSync(process.execPath, ['--check', filePath], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.status !== 0) {
  const out = (result.stdout || '').trim();
  const err = (result.stderr || '').trim();
  if (out) console.error(out);
  if (err) console.error(err);
  process.exit(result.status || 1);
}

console.log(`Syntax check passed for ${filePath}.`);
