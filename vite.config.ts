import { defineConfig } from 'vite';
export default defineConfig({ root: 'apps/viewer', build: { outDir: '../../dist/apps/viewer/public', emptyOutDir: true }, server: { host: '127.0.0.1' } });
