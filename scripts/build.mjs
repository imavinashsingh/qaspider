import { cpSync, chmodSync } from 'node:fs';
cpSync('packages/storage/migrations', 'dist/packages/storage/migrations', { recursive: true });
chmodSync('dist/packages/cli/src/main.js', 0o755);
