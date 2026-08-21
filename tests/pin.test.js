import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  pinProvider,
  unpinProvider,
  rollback,
  status,
} from '../src/pin/yamlops.js';
import { buildProviderText, validateIdentifiers } from '../src/pin/block.js';

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

test('buildProviderText emits a valid provider block with headers', () => {
  const t = buildProviderText({ sessionId: SID, userId: UID });
  assert.ok(t.includes('x-deepseek-harness-user-id'));
  assert.ok(t.includes(UID));
  assert.ok(t.includes(SID));
  assert.ok(t.includes('deepseek-v4-pro'));
  assert.ok(t.includes('thinkingFormat: deepseek'));
  assert.match(t, /^    deepseek:/m);
});

test('validateIdentifiers flags malformed ids, passes good ones', () => {
  assert.equal(validateIdentifiers({ sessionId: SID, userId: UID }).length, 0);
  assert.ok(validateIdentifiers({ sessionId: 'abc', userId: UID }).length >= 1);
});

test('pin -> insert; re-pin -> update (idempotent, single block)', async (t) => {
  await withSettings(t, async (file) => {
    const r1 = await pinProvider(file, { sessionId: SID, userId: UID });
    assert.equal(r1.changed, 'added');
    let text = await fs.readFile(file, 'utf8');
    assert.ok(text.includes(`"${SID}"`));
    assert.ok(text.includes('opencode-go'));
    assert.equal((text.match(/^    deepseek:/gm) ?? []).length, 1);

    const r2 = await pinProvider(file, { sessionId: SID, userId: UID });
    assert.equal(r2.changed, 'updated');
    text = await fs.readFile(file, 'utf8');
    assert.equal((text.match(/^    deepseek:/gm) ?? []).length, 1);
    assert.equal((text.match(/- id: deepseek-v4-pro/gm) ?? []).length, 1);
  });
});

test('unpin removes the block; rollback restores original bytes', async (t) => {
  await withSettings(t, async (file) => {
    await pinProvider(file, { sessionId: SID, userId: UID });
    const beforeUnpin = await fs.readFile(file, 'utf8');
    const u = await unpinProvider(file, {});
    assert.equal(u.changed, true);
    let text = await fs.readFile(file, 'utf8');
    assert.ok(!text.includes('    deepseek:'));
    assert.ok(text.includes('opencode-go'));

    const rb = await rollback(file);
    assert.ok(rb.restoredFrom.endsWith('.bak'));
    assert.equal(await fs.readFile(file, 'utf8'), beforeUnpin);
  });
});

test('status reports presence, masks secrets, flags shape', async (t) => {
  await withSettings(t, async (file) => {
    assert.equal((await status(file)).exists, false);
    await pinProvider(file, { sessionId: SID, userId: UID });
    const s = await status(file);
    assert.equal(s.exists, true);
    assert.equal(s.sessionMatches, true);
    assert.ok(s.sessionMasked.includes('…'));
    assert.ok(!s.sessionMasked.includes(SID));
    assert.deepEqual(s.models, ['deepseek-v4-pro', 'deepseek-v4-flash']);
  });
});

test('dry-run and rollback of a malformed-free file are safe', async (t) => {
  await withSettings(t, async (file) => {
    const before = await fs.readFile(file, 'utf8');
    const r = await pinProvider(file, { sessionId: SID, userId: UID, dryRun: true });
    assert.equal(r.dryRun, true);
    assert.equal(await fs.readFile(file, 'utf8'), before);

    const u = await unpinProvider(file, { dryRun: true });
    assert.equal(u.dryRun, true);
    assert.equal(await fs.readFile(file, 'utf8'), before);
  });
});
