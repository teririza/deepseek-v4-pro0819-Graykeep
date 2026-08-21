#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import {
  pinProvider,
  unpinProvider,
  rollback,
  status,
} from '../src/pin/yamlops.js';
import { validateIdentifiers } from '../src/pin/block.js';

const usage = `dsh-graykeep — pin/unpin/status/rollback a gray-test provider in DSH settings.yaml

USAGE
  graykeep pin [--session-id <session-...>] [--user-id <uuid>] [--provider <name>]
               [--settings <path>] [--dry-run] [--no-backup] [--models a,b]
  graykeep unpin  [--provider <name>] [--settings <path>] [--dry-run] [--no-backup]
  graykeep status [--provider <name>] [--settings <path>]
  graykeep rollback [--provider <name>] [--settings <path>]
  graykeep help

One-click flow (recommended):
  1. install nothing — zero runtime dependencies, Node >= 18 only
  2. run:   graykeep pin
  3. paste your gray-test session id when prompted -> it does everything:
     locate settings.yaml (DSH_HOME -> ~/.dsh), auto-read your user-id from
     .anonymous-user-id, backup, insert/validate, print result.

DEFAULTS
  --settings   $DSH_HOME/settings.yaml  (fallback ~/.dsh/settings.yaml)
  --provider   deepseek
  --user-id    auto-read from <settings-dir>/.anonymous-user-id, then DSH_HOME,
               then ~/.dsh/, in order
  --models     deepseek-v4-pro,deepseek-v4-flash

NOTES
  • Only pin identities from YOUR OWN gray-test session.
  • Use one pinned provider session at a time (extra sessions may cross KV caches).
  • Every write is preceded by a backup; use 'rollback' to restore.
`;

function parseArgs(argv) {
  const opts = { models: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--session-id') opts.sessionId = next();
    else if (a === '--user-id') opts.userId = next();
    else if (a === '--settings') opts.settings = next();
    else if (a === '--provider') opts.provider = next();
    else if (a === '--models') opts.models = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--display-name') opts.displayName = next();
    else if (a === '--base-url') opts.baseURL = next();
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-backup') opts.doBackup = false;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (opts.command === undefined && !a.startsWith('-')) opts.command = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

function defaultSettingsPath() {
  return process.env.DSH_HOME
    ? path.join(process.env.DSH_HOME, 'settings.yaml')
    : path.join(os.homedir(), '.dsh', 'settings.yaml');
}

async function findOwnUserId(settings) {
  const candidates = [
    path.join(path.dirname(settings), '.anonymous-user-id'),
    process.env.DSH_HOME ? path.join(process.env.DSH_HOME, '.anonymous-user-id') : null,
    path.join(os.homedir(), '.dsh', '.anonymous-user-id'),
  ].filter(Boolean);
  for (const f of candidates) {
    try {
      const v = (await fs.readFile(f, 'utf8')).trim();
      if (/^[0-9a-fA-F-]{36}$/.test(v)) return v;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

function ask(mask) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(mask, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.command === undefined) return console.log(usage);
  const settings = path.resolve(opts.settings ?? defaultSettingsPath());
  const provider = opts.provider ?? 'deepseek';
  const mods = opts.models.length ? opts.models : undefined;

  switch (opts.command) {
    case 'pin': {
      let sessionId = opts.sessionId;
      if (!sessionId) {
        sessionId = await ask('gray-test session-id (形式 session-<uuid>，来自你已抽中的灰测会话): ');
      }
      if (!sessionId) throw new Error('pin requires a session-id');
      const userId = opts.userId ?? (await findOwnUserId(settings));
      if (!userId) throw new Error('pin requires --user-id (or a local .anonymous-user-id next to settings.yaml)');
      for (const w of validateIdentifiers({ sessionId, userId })) console.warn(`! ${w}`);
      const res = await pinProvider(settings, {
        sessionId,
        userId,
        provider,
        displayName: opts.displayName,
        baseURL: opts.baseURL,
        models: mods,
        dryRun: opts.dryRun,
        doBackup: opts.doBackup !== false,
      });
      if (res.dryRun) return console.log(`[dry-run] provider "${provider}" would be ${res.changed}`);
      console.log(`[ok] provider "${provider}" ${res.changed} -> ${settings}`);
      if (res.backup) console.log(`[backup] ${res.backup}`);
      const s = await status(settings, provider);
      if (s.exists) {
        console.log(`[status] provider "${provider}" (${s.displayName})`);
        console.log(`  models  : ${(s.models ?? []).join(', ')}`);
        console.log(`  user-id : ${s.userMasked}`);
        console.log(`  session : ${s.sessionMasked}${s.sessionMatches ? '' : ' (! check shape)'}`);
      }
      return;
    }
    case 'unpin': {
      const res = await unpinProvider(settings, { provider, dryRun: opts.dryRun, doBackup: opts.doBackup !== false });
      if (res.dryRun) return console.log(`[dry-run] provider "${provider}" would be removed`);
      console.log(res.changed ? `[ok] provider "${provider}" removed from ${settings}` : `[noop] provider "${provider}" not present`);
      if (res.backup) console.log(`[backup] ${res.backup}`);
      return;
    }
    case 'status': {
      const s = await status(settings, provider);
      if (!s.exists) return console.log(`[status] provider "${provider}" NOT present in ${settings}`);
      console.log(`[status] provider "${provider}" present (${s.displayName})`);
      console.log(`  baseURL : ${s.baseURL}`);
      console.log(`  apiKey  : env:${s.apiKeyEnv}`);
      console.log(`  models  : ${(s.models ?? []).join(', ')}`);
      console.log(`  user-id : ${s.userMasked}`);
      console.log(`  session : ${s.sessionMasked}${s.sessionMatches ? ' (shape ok)' : ' (! check shape)'}`);
      return;
    }
    case 'rollback': {
      const r = await rollback(settings, provider);
      console.log(`[ok] restored ${settings} from ${r.restoredFrom}`);
      console.log(`[safety] pre-restore backup: ${r.safetyBackup}`);
      return;
    }
    default:
      throw new Error(`unknown command: ${opts.command}`);
  }
}

main().catch((e) => {
  console.error(`graykeep: ${e.message}`);
  process.exit(1);
});
