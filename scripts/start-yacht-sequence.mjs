// PM2-compatible wrapper for the yacht sequence cron
import { execSync } from 'child_process';
import { spawn } from 'child_process';

const child = spawn('node', [
  '--import', 'tsx',
  'scripts/run-yacht-sequence.ts', 'start'
], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code || 0));
