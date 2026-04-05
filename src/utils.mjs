import { mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

export function stableHash(input) {
  return createHash('sha256').update(String(input)).digest('hex');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function uuid() {
  return randomUUID();
}

export async function ensureParentDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export function nowIso() {
  return new Date().toISOString();
}

const TERMINAL_TASK_STATES = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
]);

export function isTerminalTaskState(state) {
  return TERMINAL_TASK_STATES.has(state);
}

export function extractText(parts = []) {
  return parts
    .map((part) => {
      if (typeof part?.text === 'string') return part.text;
      if (part?.data != null) return JSON.stringify(part.data, null, 2);
      if (typeof part?.url === 'string') return part.url;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}
