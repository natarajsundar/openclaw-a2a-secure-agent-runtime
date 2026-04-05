// Illustrative wiring only.
// This file shows how the relay core in src/ could be wrapped by an OpenClaw plugin.
// It is intentionally not executed by the demo, because the goal of the PoC is to keep
// the integration honest and small while still mapping onto the documented plugin API.
//
// NOTE: This file depends on `@sinclair/typebox` for schema definitions, which is NOT
// included in package.json. Install it separately if you want to run this file:
//   npm install @sinclair/typebox

import { Type } from '@sinclair/typebox';
import { OpenClawA2ARelay } from '../src/openclaw-a2a-relay.mjs';

const relay = new OpenClawA2ARelay({
  allowlist: ['https://calendar.example.com'],
});

export default function register(api) {
  api.registerTool(
    {
      name: 'a2a_delegate',
      description: 'Delegate a task to an allowlisted remote A2A agent and normalize the result.',
      parameters: Type.Object({
        targetBaseUrl: Type.String({ format: 'uri' }),
        prompt: Type.String(),
        skillId: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const result = await relay.delegate({
          sessionKey: 'main',
          targetBaseUrl: params.targetBaseUrl,
          text: params.prompt,
          skillId: params.skillId,
        });

        return {
          content: [{ type: 'text', text: result.answer }],
        };
      },
    },
    { optional: true },
  );

  api.registerGatewayMethod('a2a.status', ({ respond }) => {
    respond(true, { ok: true, plugin: 'a2a' });
  });

  api.registerHttpRoute({
    path: '/plugins/a2a/callback',
    auth: 'plugin',
    match: 'exact',
    handler: async (_req, res) => {
      res.statusCode = 202;
      res.end('accepted');
      return true;
    },
  });

  api.registerService({
    id: 'a2a-cache-warmer',
    start: () => api.logger.info('A2A relay ready'),
    stop: () => api.logger.info('A2A relay stopped'),
  });
}
