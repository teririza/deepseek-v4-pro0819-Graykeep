/**
 * Builds the provider node injected into DSH settings.yaml.
 * This is plain config — it does NOT download models or touch the network.
 */
export function buildProviderBlock({
  sessionId,
  userId,
  provider = 'deepseek',
  displayName = 'Test DeepSeek',
  baseURL = 'https://api.deepseek.com/v1',
  apiKeyEnv = 'DEEPSEEK_API_KEY',
  models = ['deepseek-v4-pro', 'deepseek-v4-flash'],
}) {
  return {
    [provider]: {
      apiKeyEnv,
      displayName,
      baseURL,
      headers: {
        'x-deepseek-harness-user-id': String(userId),
        'x-deepseek-harness-session-id': String(sessionId),
      },
      models: models.map((id) => ({
        id,
        reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
        compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
      })),
    },
  };
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
    warnings.push(`user-id does not look like a UUID. Double-check it is your own .anonymous-user-id.`);
  }
  return warnings;
}
