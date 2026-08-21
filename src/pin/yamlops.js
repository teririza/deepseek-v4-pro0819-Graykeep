import { promises as fs } from 'node:fs';
import { parse, stringify } from 'yaml';
import { buildProviderBlock } from './block.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const indentOf = (line) => (line.trim() === '' ? -1 : line.match(/^ */)[0].length);

/** Locate llm-pi-ai: and its `providers:` subkey in a list of lines. */
function findAnchors(lines) {
  const pi = lines.findIndex((l) => /^llm-pi-ai:\s*$/.test(l));
  if (pi < 0) throw new Error('settings.yaml has no `llm-pi-ai:` anchor — unsupported file shape');
  const prov = lines
    .slice(pi + 1)
    .findIndex((l) => /^ {2}providers:\s*$/.test(l));
  return { pi, providers: prov < 0 ? -1 : pi + 1 + prov };
}

/** Index of an existing `<provider>:` block at providers depth, or -1. */
function findBlockStart(lines, providersIdx, provider) {
  const re = new RegExp(`^ {4}${escapeRe(provider)}:(\\s|$)`);
  for (let i = providersIdx + 1; i < lines.length; i++) {
    if (indentOf(lines[i]) === 0) break; // next top-level key
    if (re.test(lines[i])) return i;
  }
  return -1;
}

/** End index (exclusive) of the contiguous block starting at start. */
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

function indentLines(text, n) {
  return text
    .trimEnd()
    .split('\n')
    .map((l) => ' '.repeat(n) + l)
    .join('\n');
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
  const dir = settingsPath.slice(0, Math.max(settingsPath.lastIndexOf('/'), settingsPath.lastIndexOf('\\')) + 1);
  const base = settingsPath.slice(Math.max(settingsPath.lastIndexOf('/'), settingsPath.lastIndexOf('\\')) + 1);
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith(base + '.graykeep-') && re.test(f));
  files.sort();
  return files.length ? dir + files[files.length - 1] : null;
}

/**
 * Insert or replace a provider block under llm-pi-ai.providers.
 * Always validates by re-parsing before writing; never touches the network.
 */
export async function pinProvider(settingsPath, { sessionId, userId, provider = 'deepseek', displayName, baseURL, models, dryRun = false, doBackup = true }) {
  const original = await readSettings(settingsPath);
  const blockNode = buildProviderBlock({ sessionId, userId, provider, displayName, baseURL, models });
  const blockLines = indentLines(stringify(blockNode), 4).split('\n');

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

  // Validate before writing anything.
  const parsed = parse(newText);
  const node = parsed?.['llm-pi-ai']?.providers?.[provider];
  if (!node) throw new Error('validation failed: provider block did not parse into an llm-pi-ai.providers entry');
  if (String(node.headers?.['x-deepseek-harness-session-id']) !== String(sessionId)) {
    throw new Error('validation failed: headers did not survive YAML round-trip');
  }

  if (dryRun) {
    return { dryRun: true, provider, sessionId, backup: null, changed: existing >= 0 ? 'updated' : 'added', diff: addedLines(original, newText, blockLines.length) };
  }
  const backupPath = doBackup ? await backup(settingsPath, provider) : null;
  await writeSettings(settingsPath, newText);
  return { provider, sessionId, backup: backupPath, changed: existing >= 0 ? 'updated' : 'added' };
}

export async function unpinProvider(settingsPath, { provider = 'deepseek', dryRun = false, doBackup = true }) {
  const original = await readSettings(settingsPath);
  const lines = original.split('\n');
  const { providers } = findAnchors(lines);
  if (providers < 0) throw new Error('no llm-pi-ai.providers anchor found');
  const existing = findBlockStart(lines, providers, provider);
  if (existing < 0) return { changed: false, provider, backup: null };
  const end = blockEnd(lines, existing);
  const next = [...lines.slice(0, existing), ...lines.slice(end)];
  const newText = collapseBlanks(next.join('\n'));
  // The file must still be valid YAML afterwards.
  parse(newText);
  if (dryRun) return { dryRun: true, provider, backup: null, diff: addedLines(newText, original, 0) };
  const backupPath = doBackup ? await backup(settingsPath, provider) : null;
  await writeSettings(settingsPath, newText);
  return { changed: true, provider, backup: backupPath };
}

export async function rollback(settingsPath, provider = 'deepseek') {
  const src = await latestBackup(settingsPath, provider);
  if (!src) throw new Error(`no backup found for provider "${provider}"`);
  const before = await readSettings(src);
  const backupPath = await backup(settingsPath, provider);
  await writeSettings(settingsPath, before);
  return { restoredFrom: src, safetyBackup: backupPath };
}

export async function status(settingsPath, provider = 'deepseek') {
  let text;
  try {
    text = await readSettings(settingsPath);
  } catch {
    return { exists: false, provider, error: 'settings file not found' };
  }
  const doc = parse(text);
  const node = doc?.['llm-pi-ai']?.providers?.[provider];
  if (!node) return { exists: false, provider };
  const sid = String(node.headers?.['x-deepseek-harness-session-id'] ?? '');
  const uid = String(node.headers?.['x-deepseek-harness-user-id'] ?? '');
  return {
    exists: true,
    provider,
    displayName: node.displayName,
    baseURL: node.baseURL,
    apiKeyEnv: node.apiKeyEnv,
    models: (node.models ?? []).map((m) => m.id),
    userMasked: mask(uid),
    sessionMasked: mask(sid),
    sessionMatches: /^session-[0-9a-f-]+$/i.test(sid),
  };
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

function addedLines(before, after, approx) {
  const bCount = (before.match(/\n/g) || []).length;
  const aCount = (after.match(/\n/g) || []).length;
  return { approxAdded: aCount - bCount, expectedBlockLines: approx };
}

function mask(v) {
  if (!v) return '';
  return v.length > 10 ? v.slice(0, 6) + '…' + v.slice(-4) : '…';
}
