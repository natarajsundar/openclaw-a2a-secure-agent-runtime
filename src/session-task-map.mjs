import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { ensureParentDir } from './utils.mjs';

export class SessionTaskMap {
  constructor({ filePath }) {
    this.filePath = filePath;
    this._writeLock = Promise.resolve();
  }

  async readAll() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async writeAll(records) {
    await ensureParentDir(this.filePath);
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(records, null, 2));
    try {
      await unlink(this.filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await rename(tmpPath, this.filePath);
  }

  async record(entry) {
    const work = this._writeLock.then(async () => {
      const records = await this.readAll();
      records.push({ ...entry, recordedAt: new Date().toISOString() });
      await this.writeAll(records);
    });
    this._writeLock = work.catch(() => {});
    await work;
    return entry;
  }

  async latestForSession(sessionKey, remoteBaseUrl) {
    const records = await this.readAll();
    return [...records]
      .reverse()
      .find((item) => item.sessionKey === sessionKey && item.remoteBaseUrl === remoteBaseUrl) ?? null;
  }

  async list() {
    return this.readAll();
  }
}
