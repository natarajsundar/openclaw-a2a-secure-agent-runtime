import { extractText, uuid } from './utils.mjs';

export class A2AClient {
  constructor({ rpcUrl, headers = {}, timeoutMs = 10000 }) {
    this.rpcUrl = rpcUrl;
    this.headers = headers;
    this.timeoutMs = timeoutMs;
  }

  async rpc(method, params) {
    const id = uuid();
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`A2A RPC ${method} failed: HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload.error) {
      throw new Error(`A2A RPC ${method} error: ${payload.error.message ?? 'unknown error'}`);
    }

    return payload.result;
  }

  async sendMessage({ text, contextId, taskId = undefined, metadata = {}, acceptedOutputModes = ['text/plain'] }) {
    return this.rpc('SendMessage', {
      message: {
        messageId: uuid(),
        contextId,
        ...(taskId ? { taskId } : {}),
        role: 'ROLE_USER',
        parts: [{ text }],
        metadata,
      },
      configuration: {
        acceptedOutputModes,
      },
      metadata,
    });
  }

  async getTask(taskId) {
    return this.rpc('GetTask', { id: taskId, historyLength: 10 });
  }
}

export function taskArtifactsToText(task) {
  const artifacts = Array.isArray(task?.artifacts) ? task.artifacts : [];
  const artifactText = artifacts
    .map((artifact) => extractText(artifact.parts ?? []))
    .filter(Boolean)
    .join('\n\n');

  if (artifactText) return artifactText;

  const statusMessage = extractText(task?.status?.message?.parts ?? []);
  if (statusMessage) return statusMessage;

  const historyMessage = Array.isArray(task?.history)
    ? task.history.map((message) => extractText(message.parts ?? [])).filter(Boolean).join('\n\n')
    : '';

  return historyMessage;
}
