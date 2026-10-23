import { closeSync, constants, fsyncSync, fstatSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync, lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { artifactKindSchema, idSchema, type ArtifactKind, type ArtifactRecord, type ArtifactStorage } from '../../core/src/index.js';
import { assertNoSymlinks, privateDirectory } from './filesystem.js';
import { SqliteStore } from './sqlite.js';
/** Synchronous writes + SQLite IMMEDIATE transactions serialize metadata/quota allocation. */
export class ArtifactStore implements ArtifactStorage {
  private readonly root: string;
  constructor(private readonly store: SqliteStore, root: string, private readonly now: () => number = Date.now) { this.root = privateDirectory(root); }
  private path(id: string): string {
    idSchema.parse(id); assertNoSymlinks(this.root);
    if (!lstatSync(this.root).isDirectory()) throw new Error('Artifact root is unavailable');
    const file = join(this.root, id); assertNoSymlinks(file); return file;
  }
  put(runId: string, data: Uint8Array, kind: ArtifactKind): ArtifactRecord {
    idSchema.parse(runId); artifactKindSchema.parse(kind);
    this.prune();
    let writtenPath: string | undefined;
    try {
      return this.store.transaction(() => {
        const settings = this.store.getSettings();
        if (kind === 'trace' && !settings.captureFullTraces) throw new Error('Trace capture is disabled');
        const available = this.store.listArtifacts().filter(item => item.status === 'available');
        const runBytes = available.filter(item => item.runId === runId).reduce((sum, item) => sum + item.sizeBytes, 0);
        if (runBytes + data.byteLength > settings.perRunQuotaBytes) throw new Error('Per-run quota exceeded');
        // Count physical files too: a crash between file creation and DB commit must not bypass quota.
        assertNoSymlinks(this.root);
        const diskBytes = readdirSync(this.root).reduce((sum, id) => { const stat = lstatSync(this.path(id)); if (!stat.isFile()) throw new Error('Unexpected artifact entry'); return sum + stat.size; }, 0);
        const metadataBytes = available.reduce((sum, item) => sum + item.sizeBytes, 0);
        if (Math.max(diskBytes, metadataBytes) + data.byteLength > settings.globalQuotaBytes) throw new Error('Global quota exceeded');
        const time = this.now(); const item: ArtifactRecord = { id: randomUUID(), runId, kind, sizeBytes: data.byteLength, createdAt: time, expiresAt: time + settings.retentionDays * 86400000, active: true, status: 'available' };
        const file = this.path(item.id); const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        writtenPath = file;
        try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
        this.store.insertArtifact(item); return item;
      });
    } catch (error) { if (writtenPath) unlinkSync(writtenPath); throw error; }
  }
  read(id: string): Buffer {
    const item = this.store.getArtifact(id); if (!item || item.status !== 'available') throw new Error('Artifact unavailable');
    const fd = openSync(this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { if (!fstatSync(fd).isFile()) throw new Error('Expected artifact file'); return readFileSync(fd); } finally { closeSync(fd); }
  }
  finishRun(runId: string): void { idSchema.parse(runId); this.store.finishArtifactRun(runId); }
  private remove(item: ArtifactRecord, status: 'expired' | 'deleted'): void {
    const file = this.path(item.id);
    try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.store.setArtifactStatus(item.id, status);
  }
  delete(id: string): void { idSchema.parse(id); this.store.transaction(() => { const item = this.store.getArtifact(id); if (item?.status === 'available') this.remove(item, 'deleted'); }); }
  prune(): number {
    return this.store.transaction(() => {
      const expired = this.store.listArtifacts().filter(item => item.status === 'available' && !item.active && item.expiresAt <= this.now());
      for (const item of expired) this.remove(item, 'expired'); return expired.length;
    });
  }
}
