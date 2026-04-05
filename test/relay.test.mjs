import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { OpenClawA2ARelay } from '../src/openclaw-a2a-relay.mjs';
import { startMockRemoteAgent } from '../src/mock-remote-agent.mjs';

test('relay reuses the same A2A contextId for repeated delegations from one OpenClaw session', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'relay-test-'));
  const remote = await startMockRemoteAgent({ port: 0 });
  const relay = new OpenClawA2ARelay({
    cacheDir: path.join(tmpDir, 'cache'),
    mapFilePath: path.join(tmpDir, 'session-task-map.json'),
    allowlist: [remote.baseUrl],
    timeoutMs: 3000,
  });

  try {
    const first = await relay.delegate({
      sessionKey: 'agent:main:web:test',
      targetBaseUrl: remote.baseUrl,
      text: 'Draft a plan for a design review.',
    });
    const second = await relay.delegate({
      sessionKey: 'agent:main:web:test',
      targetBaseUrl: remote.baseUrl,
      text: 'Draft a follow-up checklist for that same design review.',
    });

    assert.equal(first.state, 'TASK_STATE_COMPLETED');
    assert.equal(second.state, 'TASK_STATE_COMPLETED');
    assert.equal(first.contextId, second.contextId);
    assert.match(first.answer, /Remote agent summary/);
    assert.match(second.answer, /follow-up checklist/i);
  } finally {
    await remote.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
});
