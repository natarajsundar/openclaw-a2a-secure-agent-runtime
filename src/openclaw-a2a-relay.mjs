import path from 'node:path';
import { AgentCardCache } from './agent-card-cache.mjs';
import { A2AClient, taskArtifactsToText } from './a2a-client.mjs';
import { SessionTaskMap } from './session-task-map.mjs';
import { isTerminalTaskState, sleep, uuid } from './utils.mjs';

export class OpenClawA2ARelay {
  constructor({ cacheDir, mapFilePath, pollIntervalMs = 150, timeoutMs = 5000, allowlist = [], allowAll = false } = {}) {
    this.agentCardCache = new AgentCardCache({ cacheDir: cacheDir ?? path.resolve('data/cache'), fetchTimeoutMs: timeoutMs });
    this.sessionTaskMap = new SessionTaskMap({ filePath: mapFilePath ?? path.resolve('data/session-task-map.json') });
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
    this.allowAll = allowAll;
    this.allowlist = new Set(allowlist.map((url) => String(url).replace(/\/$/, '')));
  }

  async resolveAgent(targetBaseUrl) {
    const normalizedBaseUrl = String(targetBaseUrl).replace(/\/$/, '');
    if (!this.allowAll) {
      if (this.allowlist.size === 0) {
        throw new Error('No remote agents are allowlisted; refusing to resolve any agent');
      }
      if (!this.allowlist.has(normalizedBaseUrl)) {
        throw new Error(`Remote agent ${normalizedBaseUrl} is not allowlisted`);
      }
    }

    const { card, source } = await this.agentCardCache.get(normalizedBaseUrl);
    if (!card?.url) {
      throw new Error(`Agent Card from ${normalizedBaseUrl} did not include a service URL`);
    }

    // Guard against SSRF: the RPC URL declared in the Agent Card must stay on the
    // same origin as the allowlisted base URL so a compromised card cannot redirect
    // requests to an arbitrary internal host.
    const allowlistedOrigin = new URL(normalizedBaseUrl).origin;
    const cardRpcUrl = new URL(card.url, normalizedBaseUrl);
    if (cardRpcUrl.origin !== allowlistedOrigin) {
      throw new Error(
        `Agent Card from ${normalizedBaseUrl} specifies RPC URL on different origin: ${cardRpcUrl.href}`
      );
    }

    return {
      card,
      cardSource: source,
      rpcUrl: cardRpcUrl.toString(),
      remoteBaseUrl: normalizedBaseUrl,
    };
  }

  async delegate({ sessionKey, targetBaseUrl, text, metadata = {}, skillId = undefined }) {
    const resolved = await this.resolveAgent(targetBaseUrl);
    const previous = await this.sessionTaskMap.latestForSession(sessionKey, resolved.remoteBaseUrl);
    const contextId = previous?.contextId ?? uuid();

    const client = new A2AClient({ rpcUrl: resolved.rpcUrl, timeoutMs: this.timeoutMs });
    const sendResult = await client.sendMessage({
      text,
      contextId,
      metadata: {
        ...metadata,
        ...(skillId ? { requestedSkillId: skillId } : {}),
        openclawSessionKey: sessionKey,
      },
    });

    if (sendResult.message) {
      const directText = taskArtifactsToText({ history: [sendResult.message] });
      return {
        type: 'message',
        cardSource: resolved.cardSource,
        remoteAgent: resolved.card.name,
        contextId,
        answer: directText,
      };
    }

    let task = sendResult.task;
    if (!task?.id) {
      throw new Error('A2A response did not contain a task or direct message');
    }

    await this.sessionTaskMap.record({
      sessionKey,
      remoteBaseUrl: resolved.remoteBaseUrl,
      remoteAgentName: resolved.card.name,
      taskId: task.id,
      contextId,
      state: task.status?.state ?? 'TASK_STATE_UNSPECIFIED',
      requestPreview: text.slice(0, 160),
    });

    const start = Date.now();
    while (!isTerminalTaskState(task.status?.state)) {
      if (Date.now() - start > this.timeoutMs) {
        return {
          type: 'task-timeout',
          cardSource: resolved.cardSource,
          remoteAgent: resolved.card.name,
          contextId,
          taskId: task.id,
          state: task.status?.state,
          answer: taskArtifactsToText(task) || 'Task accepted but did not finish before the relay timeout.',
        };
      }

      await sleep(this.pollIntervalMs);
      task = await client.getTask(task.id);
    }

    const answer = taskArtifactsToText(task);
    await this.sessionTaskMap.record({
      sessionKey,
      remoteBaseUrl: resolved.remoteBaseUrl,
      remoteAgentName: resolved.card.name,
      taskId: task.id,
      contextId,
      state: task.status?.state ?? 'TASK_STATE_UNSPECIFIED',
      requestPreview: text.slice(0, 160),
      responsePreview: answer.slice(0, 160),
    });

    return {
      type: 'task',
      cardSource: resolved.cardSource,
      remoteAgent: resolved.card.name,
      contextId,
      taskId: task.id,
      state: task.status?.state,
      answer,
      task,
    };
  }
}
