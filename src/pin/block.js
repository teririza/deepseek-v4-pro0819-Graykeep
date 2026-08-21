/**
 * Builds the provider block text injected into DSH settings.yaml (indent 4).
 * Zero-dependency: pure string generation, no YAML library needed.
 */
export function buildProviderText({
  sessionId,
  userId,
  provider = 'deepseek',
  displayName = 'Test DeepSeek',
  baseURL = 'https://api.deepseek.com/v1',
  apiKeyEnv = 'DEEPSEEK_API_KEY',
  models = ['deepseek-v4-pro', 'deepseek-v4-flash'],
}) {
  const lines = [];
  const push = (ind, l) => lines.push(' '.repeat(ind) + l);
  push(4, `${provider}:`);
  push(6, `apiKeyEnv: ${apiKeyEnv}`);
  push(6, `displayName: "${displayName}"`);
  push(6, `baseURL: ${baseURL}`);
  push(6, 'headers:');
  push(8, `"x-deepseek-harness-user-id": "${String(userId)}"`);
  push(8, `"x-deepseek-harness-session-id": "${String(sessionId)}"`);
  push(6, 'models:');
  for (const id of models) {
    push(8, `- id: ${id}`);
    push(10, 'reasoningEfforts:');
    push(12, 'off: null');
    push(12, 'low: low');
    push(12, 'high: high');
    push(12, 'max: max');
    push(10, 'compat:');
    push(12, 'thinkingFormat: deepseek');
    push(12, 'supportsReasoningEffort: true');
  }
  return lines.join('\n');
}

/** Validate identifier shape; return warnings (not fatal). */
export function validateIdentifiers({ sessionId, userId }) {
  const warnings = [];
  if (!/^session-[0-9a-fA-F-]{36}$/.test(String(sessionId))) {
    warnings.push(
      `session-id "${sessionId}" does not look like a DSH session id (expected session-<uuid>). Double-check the value captured from YOUR OWN gray session.`
    );
  }
  if (!/^[0-9a-fA-F-]{36}$/.test(String(userId))) {
    warnings.push(`user-id does not look like a UUID. Double-check it is your own .anonymous-user-id`);
  }
  return warnings;
}
