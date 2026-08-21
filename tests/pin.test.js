import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import {
  pinProvider,
  unpinProvider,
  rollback,
  status,
} from '../src/pin/yamlops.js';
import { buildProviderBlock, validateIdentifiers } from '../src/pin/block.js';

const SAMPLE = `ui-onboarding:
  welcomeNoticeVersion: 2026-08-13.1
llm-pi-ai:
  providers:
    opencode-go:
      apiKeyEnv: OPENCODE_GO_API_KEY
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-pro
  reasoningEffort: max
`;

async function withSettings(t, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graykeep-'));
  const file = path.join(dir, 'settings.yaml');
  await fs.writeFile(file, SAMPLE, 'utf8');
  try {
    await fn(file, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const SID = 'session-2213a0f3-5f34-4b65-b83e-89878fe65361';
const UID = 'd68b06ec-2606-4e46-969d-5e6db961b1f8';

test('buildProviderBlock emits a valid provider node with headers', () => {
  const node = buildProviderBlock({ sessionId: SID, userId: UID });
  const p = node.deepseek;
  assert.equal(p.headers['x-deepseek-harness-user-id'], UID);
  assert.equal(p.headers['x-deepseek-harness-session-id'], SID);
  assert.deepEqual(p.models.map((m) => m.id), ['deepseek-v4-pro', 'deepseek-v4-flash']);
  assert.equal(p.models[0].compat.thinkingFormat, 'deepseek');
});

test('validateIdentifiers flags malformed ids, passes good ones', () => {
  assert.ok(validateIdentifiers({ sessionId: SID, userId: UID }).length === 0);
  assert.ok(validateIdentifiers({ sessionId: 'abc', userId: UID }).length >= 1);
});

test('pin -> insert + validate; re-pin -> update (idempotent)', async (t) => {
  await withSettings(t, async (file) => {
    const r1 = await pinProvider(file, { sessionId: SID, userId: UID });
    assert.equal(r1.changed, 'added');
    let doc = parse(await fs.readFile(file, 'utf8'));
    assert.equal(doc['llm-pi-ai'].providers.deepseek.headers['x-deepseek-harness-session-id'], SID);
    // original sibling still present
    assert.ok(doc['llm-pi-ai'].providers['opencode-go']);

    const r2 = await pinProvider(file, { sessionId: SID, userId: UID, provider: 'deepseek' });
    assert.equal(r2.changed, 'updated');
    doc = parse(await fs.readFile(file, 'utf8'));
    const providers = doc['llm-pi-ai'].providers;
    assert.deepEqual(Object.keys(providers).filter((k) => k === 'deepseek'), ['deepseek']);
    assert.equal(providers.deepseek.models.length, 2);
  });
});

test('unpin removes the block; rollback restores original bytes', async (t) => {
  await withSettings(t, async (file) => {
    await pinProvider(file, { sessionId: SID, userId: UID });
    const beforeUnpin = await fs.readFile(file, 'utf8');
    const u = await unpinProvider(file, {});
    assert.equal(u.changed, true);
    const doc = parse(await fs.readFile(file, 'utf8'));
    assert.equal(doc['llm-pi-ai'].providers.deepseek, undefined);
    assert.ok(doc['llm-pi-ai'].providers['opencode-go']);

    const rb = await rollback(file);
    assert.ok(rb.restoredFrom.endsWith('.bak'));
    const restored = await fs.readFile(file, 'utf8');
    // rollback restores the backup taken right before unpin
    assert.equal(restored, beforeUnpin);
  });
});

test('status reports presence and masks secrets', async (t) => {
  await withSettings(t, async (file) => {
    assert.equal((await status(file)).exists, false);
    await pinProvider(file, { sessionId: SID, userId: UID });
    const s = await status(file);
    assert.equal(s.exists, true);
    assert.equal(s.sessionMatches, true);
    assert.ok(s.sessionMasked.includes('…'));
    assert.ok(!s.sessionMasked.includes(SID));
  });
});

test('dry-run does not modify the file', async (t) => {
  await withSettings(t, async (file) => {
    const before = await fs.readFile(file, 'utf8');
    const r = await pinProvider(file, { sessionId: SID, userId: UID, dryRun: true });
    assert.equal(r.dryRun, true);
    assert.equal(await fs.readFile(file, 'utf8'), before);
  });
});
