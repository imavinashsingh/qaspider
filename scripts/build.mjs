import { cpSync, chmodSync } from 'node:fs';
cpSync('packages/storage/migrations', 'dist/packages/storage/migrations', { recursive: true });
chmodSync('dist/packages/cli/src/main.js', 0o755);

cpSync('packages/studio/migrations', 'dist/packages/studio/migrations', { recursive: true });

cpSync('packages/engine/migrations', 'dist/packages/engine/migrations', { recursive: true });
