import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureParentDir, stableHash } from './utils.mjs';

const DEFAULT_CARD_PATH = '/.well-known/agent-card.json';

export class AgentCardCache {
  constructor({ cacheDir, defaultTtlMs = 5 * 60 * 1000, fetchTimeoutMs = 10000 } = {}) {
    this.cacheDir = cacheDir ?? path.resolve('data');
    this.defaultTtlMs = defaultTtlMs;
    this.fetchTimeoutMs = fetchTimeoutMs;
  }

  cacheFile(baseUrl) {
    return path.join(this.cacheDir, `${stableHash(baseUrl)}.agent-card.json`);
  }

  async readEntry(baseUrl) {
    const filePath = this.cacheFile(baseUrl);
    try {
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async writeEntry(baseUrl, entry) {
    const filePath = this.cacheFile(baseUrl);
    await ensureParentDir(filePath);
    await writeFile(filePath, JSON.stringify(entry, null, 2));
  }

  async get(baseUrl) {
    const normalizedBase = String(baseUrl).replace(/\/$/, '');
    const entry = await this.readEntry(normalizedBase);
    const now = Date.now();

    if (entry && entry.expiresAt > now) {
      return { card: entry.card, source: 'cache', etag: entry.etag ?? null };
    }

    const headers = {};
    if (entry?.etag) {
      headers['If-None-Match'] = entry.etag;
    }

    const response = await fetch(`${normalizedBase}${DEFAULT_CARD_PATH}`, {
      headers,
      signal: AbortSignal.timeout(this.fetchTimeoutMs),
    });

    if (response.status === 304 && entry?.card) {
      const refreshed = {
        ...entry,
        expiresAt: now + this.defaultTtlMs,
      };
      await this.writeEntry(normalizedBase, refreshed);
      return { card: refreshed.card, source: 'revalidated-cache', etag: refreshed.etag ?? null };
    }

    if (!response.ok) {
      throw new Error(`Unable to fetch Agent Card from ${normalizedBase}: HTTP ${response.status}`);
    }

    const card = await response.json();
    const cacheControl = response.headers.get('cache-control') ?? '';
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
    const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : this.defaultTtlMs;
    const nextEntry = {
      baseUrl: normalizedBase,
      fetchedAt: new Date().toISOString(),
      expiresAt: now + ttlMs,
      etag: response.headers.get('etag'),
      card,
    };

    await this.writeEntry(normalizedBase, nextEntry);
    return { card, source: 'network', etag: nextEntry.etag ?? null };
  }
}
