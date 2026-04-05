import http from 'node:http';
import { extractText, nowIso, sleep, uuid } from './utils.mjs';

export async function startMockRemoteAgent({ port = 0 } = {}) {
  const tasks = new Map();
  let baseUrl = '';
  const agentCard = {
    name: 'Calendar Specialist Agent',
    description: 'A mock remote A2A agent that turns scheduling requests into concise plans.',
    version: '1.0.0',
    url: null,
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    skills: [
      {
        id: 'calendar.plan',
        name: 'Plan scheduling work',
        description: 'Summarizes a scheduling or delegation request into actionable steps.',
        tags: ['calendar', 'schedule', 'planning'],
        examples: ['Draft a meeting follow-up plan', 'Turn this calendar request into next steps'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
    ],
  };
  const etag = 'W/"calendar-specialist-v1"';

  function json(response, statusCode, payload, headers = {}) {
    response.writeHead(statusCode, {
      'content-type': 'application/json',
      ...headers,
    });
    response.end(JSON.stringify(payload));
  }

  async function completeTaskLater(taskId, requestText) {
    await sleep(250);
    const existing = tasks.get(taskId);
    if (!existing) return;

    existing.status = {
      state: 'TASK_STATE_COMPLETED',
      timestamp: nowIso(),
      message: {
        messageId: uuid(),
        role: 'ROLE_AGENT',
        parts: [{ text: 'Task finished successfully.' }],
      },
    };
    existing.artifacts = [
      {
        artifactId: uuid(),
        name: 'plan.txt',
        description: 'Normalized output from the remote scheduling specialist.',
        parts: [
          {
            text: [
              `Remote agent summary for: ${requestText}`,
              '',
              'Recommended next steps:',
              '1. Confirm the target audience and expected outcome.',
              '2. Produce a short checklist or draft response.',
              '3. Return a final summary to the calling assistant.',
            ].join('\n'),
            mediaType: 'text/plain',
          },
        ],
      },
    ];
    tasks.set(taskId, existing);
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, baseUrl);

    if (request.method === 'GET' && url.pathname === '/.well-known/agent-card.json') {
      if (request.headers['if-none-match'] === etag) {
        response.writeHead(304, {
          etag,
          'cache-control': 'max-age=120',
        });
        response.end();
        return;
      }

      json(response, 200, agentCard, {
        etag,
        'cache-control': 'max-age=120',
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/rpc') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));

      if (payload.method === 'SendMessage') {
        const requestText = extractText(payload.params?.message?.parts ?? []);
        const taskId = uuid();
        const contextId = payload.params?.message?.contextId ?? uuid();
        const task = {
          id: taskId,
          contextId,
          history: [payload.params.message],
          status: {
            state: 'TASK_STATE_WORKING',
            timestamp: nowIso(),
            message: {
              messageId: uuid(),
              role: 'ROLE_AGENT',
              parts: [{ text: 'Task accepted and being processed.' }],
            },
          },
          artifacts: [],
          metadata: {
            requestedSkillId: payload.params?.metadata?.requestedSkillId ?? null,
          },
        };
        tasks.set(taskId, task);
        void completeTaskLater(taskId, requestText);
        json(response, 200, {
          jsonrpc: '2.0',
          id: payload.id,
          result: { task },
        });
        return;
      }

      if (payload.method === 'GetTask') {
        const task = tasks.get(payload.params?.id);
        if (!task) {
          json(response, 200, {
            jsonrpc: '2.0',
            id: payload.id,
            error: {
              code: -32001,
              message: 'Task not found',
            },
          });
          return;
        }

        json(response, 200, {
          jsonrpc: '2.0',
          id: payload.id,
          result: task,
        });
        return;
      }

      json(response, 200, {
        jsonrpc: '2.0',
        id: payload.id,
        error: {
          code: -32601,
          message: 'Method not found',
        },
      });
      return;
    }

    response.writeHead(404);
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('error', onError);
      reject(error);
    };

    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      const assignedPort = server.address().port;
      baseUrl = `http://127.0.0.1:${assignedPort}`;
      agentCard.url = `${baseUrl}/rpc`;
      resolve();
    });
  });

  return {
    baseUrl,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
