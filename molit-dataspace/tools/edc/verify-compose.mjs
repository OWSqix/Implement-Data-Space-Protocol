import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolDirectory, '..', '..');
const composeFiles = [
  path.join(root, 'deploy', 'edc', 'compose.yaml'),
  path.join(root, 'deploy', 'edc', 'compose.smoke.yaml'),
];
const args = ['compose'];
for (const file of composeFiles) args.push('-f', file);
args.push('config', '--quiet');

const child = spawn('docker', args, {
  cwd: root,
  env: {
    ...process.env,
    EDC_POSTGRES_PASSWORD: 'compose-verification-placeholder',
    PROVIDER_API_KEY: 'compose-verification-placeholder',
    CONSUMER_API_KEY: 'compose-verification-placeholder',
  },
  stdio: 'inherit',
  windowsHide: true,
});

child.once('error', (error) => {
  process.stderr.write(`Docker Compose verification could not start: ${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) process.stderr.write(`Docker Compose verification stopped by ${signal}\n`);
  process.exitCode = code ?? 1;
});
