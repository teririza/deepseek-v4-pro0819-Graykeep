import { promises as fs } from 'node:fs';
import { buildProviderText } from './block.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const indentOf = (line) => (line.trim() === '' ? -1 : line.match(/^ */)[0].length);

/** Locate llm-pi-ai: and its `providers:` subkey. */
function findAnchors(lines) {
  const pi = lines.findIndex((l) => /^llm-pi-ai:\s*$/.test(l));
  if (pi < 0) throw new Error('settings.yaml has no `llm-pi-ai:` anchor — unsupported file shape');
  const provIdx = lines.slice(pi + 1).findIndex((l) => /^ {2}providers:\s*$/.test(l));
  return { providers: provIdx < 0 ? -1 : pi + 1 + provIdx, pi };
}

/** Index of an existing `<provider>:` block under providers (4-space), or -1. */
function findBlockStart(lines, providersIdx, provider) {
  const re = new RegExp(`^ {4}${escapeRe(provider)}:(\\s|$)`);
  for (let i = providersIdx + 1; i < lines.length; i++) {
    if (indentOf(lines[i]) === 0) break; // next top-level key
    if (re.test(lines[i])) return i;
  }
  return -1;
}

/** End index (exclusive) of the contiguous block starting at `start`. */
function blockEnd(lines, start) {
  let i = start + 1;
  while (i < lines.length) {
    const ind = indentOf(lines[i]);
    if (ind === -1) {
      i++;
      continue;
    }
    if (ind <= 4) break; // a new 4-space sibling or shallower key
    i++; // nested (6+ spaces) content
  }
  return i;
}

function collapseBlanks(text) {
  return text
    .split('\n')
    .reduce((acc, l) => {
      if (l.trim() === '' && acc.length && acc[acc.length - 1].trim() === '') return acc;
      acc.push(l);
      return acc;
    }, [])
    .join('\n')
    .replace(/\n+$/, '\n');
}

const normalize = (text) => collapseBlanks(text).trim();

/** Remove the `<provider>:` block (used by unpin and by write-time verification). */
function removeBlock(lines, provider) {
  let anchors;
  try {
    anchors = findAnchors(lines);
  } catch {
    return lines;
  }
  if (anchors.providers < 0) return lines;
  const start = findBlockStart(lines, anchors.providers, provider);
  if (start < 0) return lines;
  const end = blockEnd(lines, start);
  return [...lines.slice(0, start), ...lines.slice(end)];
}

export async function readSettings(settingsPath) {
  return fs.readFile(settingsPath, 'utf8');
}

export async function writeSettings(settingsPath, text) {
  await fs.writeFile(settingsPath, text, 'utf8');
}

export async function backup(settingsPath, provider) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${settingsPath}.graykeep-${provider}-${ts}.bak`;
  await fs.copyFile(settingsPath, dest);
  return dest;
}

export async function latestBackup(settingsPath, provider) {
  const re = new RegExp(`${escapeRe(provider)}-\\d{4}-\\d{2}-\\d{2}T[^/]*\\.bak$`);
  const sep = Math.max(settingsPath.lastIndexOf('/'), settingsPath.lastIndexOf('\\'));
  const dir = settingsPath.slice(0, sep + 1);
  const base = settingsPath.slice(sep + 1);
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith(base + '.graykeep-') && re.test(f));
  files.sort();
  return files.length ? dir + files[files.length - 1] : null;
}

/**
 * Insert or replace a provider block under llm-pi-ai.providers.
 * Zero-dependency safety: before writing, remove the injected block again and
 * assert it reproduces the original settings — a text-level round-trip check.
 */
export async function pinProvider(
  settingsPath,
  { sessionId, userId, provider = 'deepseek', displayName, baseURL, models, dryRun = false, doBackup = true }
) {
  const original = await readSettings(settingsPath);
  const block = buildProviderText({ sessionId, userId, provider, displayName, baseURL, models });
  const blockLines = block.split('\n');

  const lines = original.split('\n');
  const { providers } = findAnchors(lines);
  if (providers < 0) throw new Error('settings.yaml has `llm-pi-ai:` but no `  providers:` — unsupported file shape');

  const existing = findBlockStart(lines, providers, provider);
  let next;
  if (existing >= 0) {
    const end = blockEnd(lines, existing);
    next = [...lines.slice(0, existing), ...blockLines, ...lines.slice(end)];
  } else {
    next = [...lines.slice(0, providers + 1), ...blockLines, ...lines.slice(providers + 1)];
  }
  const newText = collapseBlanks(next.join('\n'));

  // Round-trip verification (no external parser): removing the injected block
  // must leave the file EXACTLY as it was with the previous block removed —
  // i.e. the block is the ONLY sanctioned change vs the original.
  const repro = normalize(removeBlock(newText.split('\n'), provider).join('\n'));
  const base = normalize(removeBlock(original.split('\n'), provider).join('\n'));
  if (repro !== base) {
    throw new Error('verification failed: removing the injected block does not reproduce the original (unpinned) settings.yaml');
  }
  for (const needle of [String(sessionId), `${provider}:`]) {
    if (!newText.includes(needle)) throw new Error(`verification failed: block missing "${needle}"`);
  }

  if (dryRun) return { dryRun: true, provider, sessionId, backup: null, changed: existing >= 0 ? 'updated' : 'added' };
  const backupPath = doBackup ? await backup(settingsPath, provider) : null;
  await writeSettings(settingsPath, newText);
  return { provider, sessionId, backup: backupPath, changed: existing >= 0 ? 'updated' : 'added' };
}

export async function unpinProvider(settingsPath, { provider = 'deepseek', dryRun = false, doBackup = true }) {
  const original = await readSettings(settingsPath);
  const next = removeBlock(original.split('\n'), provider);
  const newText = collapseBlanks(next.join('\n'));
  if (normalize(newText) === normalize(original)) {
    return { changed: false, provider, backup: null, dryRun: Boolean(dryRun) };
  }
  findAnchors(next); // throws if the file shape was wrecked
  if (dryRun) return { dryRun: true, provider, backup: null };
  const backupPath = doBackup ? await backup(settingsPath, provider) : null;
  await writeSettings(settingsPath, newText);
  return { changed: true, provider, backup: backupPath };
}

export async function rollback(settingsPath, provider = 'deepseek') {
  const src = await latestBackup(settingsPath, provider);
  if (!src) throw new Error(`no backup found for provider "${provider}"`);
  const before = await readSettings(src);
  const safetyBackup = await backup(settingsPath, provider);
  await writeSettings(settingsPath, before);
  return { restoredFrom: src, safetyBackup };
}

export async function status(settingsPath, provider = 'deepseek') {
  let text;
  try {
    text = await readSettings(settingsPath);
  } catch {
    return { exists: false, provider, error: 'settings file not found' };
  }
  const lines = text.split('\n');
  let providers;
  try {
    ({ providers } = findAnchors(lines));
  } catch {
    return { exists: false, provider };
  }
  const start = findBlockStart(lines, providers, provider);
  if (start < 0) return { exists: false, provider };
  const block = lines.slice(start, blockEnd(lines, start)).join('\n');
  const sid = ((block.match(/x-deepseek-harness-session-id"\s*:\s*"([^"]+)"/) ?? [])[1] ?? '').replace(/"/g, '');
  const uid = ((block.match(/x-deepseek-harness-user-id"\s*:\s*"([^"]+)"/) ?? [])[1] ?? '').replace(/"/g, '');
  return {
    exists: true,
    provider,
    displayName: ((block.match(/displayName:\s*(.+)/) ?? [])[1] ?? '').trim(),
    baseURL: ((block.match(/baseURL:\s*(\S+)/) ?? [])[1] ?? ''),
    apiKeyEnv: ((block.match(/apiKeyEnv:\s*(\S+)/) ?? [])[1] ?? ''),
    models: Array.from(block.matchAll(/^\s*- id:\s*(\S+)/gm), (m) => m[1]),
    userMasked: mask(uid),
    sessionMasked: mask(sid),
    sessionMatches: /^session-[0-9a-f-]+$/i.test(sid),
  };
}

function mask(v) {
  if (!v) return '';
  return v.length > 10 ? v.slice(0, 6) + '…' + v.slice(-4) : '…';
}
