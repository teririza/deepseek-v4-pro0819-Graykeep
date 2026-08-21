#!/usr/bin/env node
import { promises as fs } from 'node:fs';
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
  graykeep pin    --session-id <session-...> [--user-id <uuid>] [--provider <name>]
                  [--settings <path>] [--dry-run] [--no-backup] [--models a,b]
  graykeep unpin  [--provider <name>] [--settings <path>] [--dry-run] [--no-backup]
  graykeep status [--provider <name>] [--settings <path>]
  graykeep rollback [--provider <name>] [--settings <path>]
  graykeep help

DEFAULTS
  --settings   $DSH_HOME/settings.yaml  (fallback ~/.dsh/settings.yaml)
  --provider   deepseek
  --user-id    auto-read from <settings-dir>/.anonymous-user-id if present
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

async function readOwnUserId(settings) {
  try {
    const dir = path.dirname(settings);
    const f = path.join(dir, '.anonymous-user-id');
    const v = (await fs.readFile(f, 'utf8')).trim();
    return /^[0-9a-fA-F-]{36}$/.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.command === undefined) return console.log(usage);
  const settings = path.resolve(opts.settings ?? defaultSettingsPath());
  const provider = opts.provider ?? 'deepseek';
  const mods = opts.models.length ? opts.models : undefined;

  switch (opts.command) {
    case 'pin': {
      if (!opts.sessionId) throw new Error('pin requires --session-id');
      const userId = opts.userId ?? (await readOwnUserId(settings));
      if (!userId) throw new Error('pin requires --user-id (or a local .anonymous-user-id next to settings.yaml)');
      for (const w of validateIdentifiers({ sessionId: opts.sessionId, userId })) console.warn(`! ${w}`);
      const res = await pinProvider(settings, {
        sessionId: opts.sessionId,
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
