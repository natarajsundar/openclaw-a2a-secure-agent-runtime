import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenClawA2ARelay } from './openclaw-a2a-relay.mjs';
import { startMockRemoteAgent } from './mock-remote-agent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const remote = await startMockRemoteAgent({ port: 4040 });
  const relay = new OpenClawA2ARelay({
    cacheDir: path.resolve(__dirname, '../data/cache'),
    mapFilePath: path.resolve(__dirname, '../data/session-task-map.json'),
    allowlist: [remote.baseUrl],
    timeoutMs: 3000,
  });

  try {
    const first = await relay.delegate({
      sessionKey: 'agent:main:web:dm:demo',
      targetBaseUrl: remote.baseUrl,
      text: 'Turn this meeting request into a short plan for tomorrow morning.',
      skillId: 'calendar.plan',
      metadata: { requestedBy: 'demo-script' },
    });

    const second = await relay.delegate({
      sessionKey: 'agent:main:web:dm:demo',
      targetBaseUrl: remote.baseUrl,
      text: 'Now rewrite that plan as a follow-up checklist I can send to a teammate.',
      skillId: 'calendar.plan',
      metadata: { requestedBy: 'demo-script' },
    });

    console.log('\n=== First delegation ===');
    console.log(JSON.stringify(first, null, 2));
    console.log('\n=== Second delegation (same OpenClaw session) ===');
    console.log(JSON.stringify(second, null, 2));
    console.log('\nContext reused across turns:', first.contextId === second.contextId);
  } finally {
    await remote.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
