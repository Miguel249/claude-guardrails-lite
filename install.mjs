#!/usr/bin/env node
/**
 * install.mjs — wire the hooks into settings.json.
 *
 *   node install.mjs                  install for the current project
 *   node install.mjs --global         install for every project on this machine
 *   node install.mjs --uninstall      remove guardrails entries, leave the rest
 *   node install.mjs --dry-run        print the resulting settings without writing
 *   node install.mjs --here           don't relocate; wire hooks to this folder
 *
 * settings.json is the user's file and may contain hooks that have nothing to
 * do with this kit. Every write is preceded by a timestamped backup, and
 * removal matches only entries whose command points at this installation, so a
 * reinstall or uninstall never touches anything else.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARKER = 'claude-guardrails-lite';

const argv = new Set(process.argv.slice(2));
const isGlobal = argv.has('--global') || argv.has('-g');
const isUninstall = argv.has('--uninstall');
const isDryRun = argv.has('--dry-run');
const stayHere = argv.has('--here');

/** Where a relocated copy lives. Stable across npx cache eviction. */
const INSTALL_HOME = path.join(os.homedir(), '.claude', MARKER);

/**
 * Is this copy running from somewhere that will be deleted?
 *
 * `npx github:user/repo` unpacks into a cache directory that npm prunes on its
 * own schedule. Wiring hooks to that path produces an install that works today
 * and silently breaks in a week, which is worse than refusing to install.
 */
function isEphemeral(dir) {
  const p = dir.replace(/\\/g, '/').toLowerCase();
  return (
    /\/_npx\//.test(p) ||
    /\/npm-cache\//.test(p) ||
    /\/\.npm\/_cacache\//.test(p) ||
    p.startsWith(os.tmpdir().replace(/\\/g, '/').toLowerCase())
  );
}

/** Copy the runtime files to INSTALL_HOME so the hook paths stay valid. */
function relocate() {
  const payload = ['lib', 'hooks', 'install.mjs', 'package.json', 'guardrails.config.json', 'README.md', 'LICENSE.md', 'QUICKSTART.md'];
  fs.mkdirSync(INSTALL_HOME, { recursive: true });
  for (const entry of payload) {
    const from = path.join(HERE, entry);
    if (!fs.existsSync(from)) continue; // the lite build ships fewer files
    fs.cpSync(from, path.join(INSTALL_HOME, entry), { recursive: true, force: true });
  }
  return INSTALL_HOME;
}

// Resolve the home before anything reads HOOKS, since relocation changes it.
const ROOT_DIR = !isUninstall && !isDryRun && !stayHere && isEphemeral(HERE) ? relocate() : HERE;
const HOOKS = path.join(ROOT_DIR, 'hooks');
const RELOCATED = ROOT_DIR !== HERE;

/** Absolute, forward-slashed, quoted — survives PowerShell, cmd, and bash alike. */
function hookCommand(file) {
  return `node "${path.join(HOOKS, file).replace(/\\/g, '/')}"`;
}

/** event -> matcher -> hook script */
const WIRING = [
  { event: 'SessionStart', matcher: undefined, file: 'session-context.mjs', timeout: 15 },
  { event: 'PreToolUse', matcher: 'Bash', file: 'guard-bash.mjs', timeout: 10 },
];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Drop every hook entry this kit installed, at any version or path depth. */
function stripGuardrails(hooks) {
  if (!hooks || typeof hooks !== 'object') return {};
  const out = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      out[event] = groups;
      continue;
    }
    const kept = groups
      .map((group) => {
        const inner = (group.hooks || []).filter(
          (h) => !(typeof h.command === 'string' && h.command.includes(MARKER)),
        );
        return { ...group, hooks: inner };
      })
      // A group emptied of guardrails hooks would otherwise linger as noise.
      .filter((group) => (group.hooks || []).length > 0);
    if (kept.length) out[event] = kept;
  }
  return out;
}

function addGuardrails(hooks) {
  const out = { ...hooks };
  for (const wire of WIRING) {
    const entry = {
      type: 'command',
      command: hookCommand(wire.file),
      timeout: wire.timeout,
      ...(wire.async ? { async: true } : {}),
    };
    const groups = Array.isArray(out[wire.event]) ? [...out[wire.event]] : [];

    // Reuse an existing group with the same matcher so we do not fragment the
    // user's configuration into one group per hook.
    const existing = groups.find((g) => (g.matcher ?? undefined) === wire.matcher);
    if (existing) {
      existing.hooks = [...(existing.hooks || []), entry];
    } else {
      groups.push(wire.matcher === undefined ? { hooks: [entry] } : { matcher: wire.matcher, hooks: [entry] });
    }
    out[wire.event] = groups;
  }
  return out;
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${file}.backup-${stamp}`;
  fs.copyFileSync(file, dest);
  return dest;
}

function main() {
  const claudeDir = isGlobal ? path.join(os.homedir(), '.claude') : path.join(process.cwd(), '.claude');
  const settingsFile = path.join(claudeDir, 'settings.json');

  // The kit must live where the hook commands point. Refuse rather than write
  // paths that will 404 on the first tool call.
  if (!fs.existsSync(HOOKS)) {
    console.error(`✗ hooks/ not found next to install.mjs (looked in ${HOOKS})`);
    process.exit(1);
  }
  if (!ROOT_DIR.includes(MARKER)) {
    console.error(
      `✗ This kit must stay in a directory named "${MARKER}" so uninstall can identify its hooks.\n` +
        `  Current location: ${ROOT_DIR}`,
    );
    process.exit(1);
  }

  fs.mkdirSync(claudeDir, { recursive: true });
  const settings = readJson(settingsFile, {});

  settings.hooks = isUninstall
    ? stripGuardrails(settings.hooks)
    : addGuardrails(stripGuardrails(settings.hooks));
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  const serialized = JSON.stringify(settings, null, 2) + '\n';

  if (isDryRun) {
    console.log(`--- ${settingsFile} (dry run) ---`);
    console.log(serialized);
    return;
  }

  const saved = backup(settingsFile);
  fs.writeFileSync(settingsFile, serialized, 'utf8');

  // Seed a config file so the user has something to edit rather than a blank page.
  const configFile = path.join(claudeDir, 'guardrails.config.json');
  if (!isUninstall && !fs.existsSync(configFile)) {
    fs.copyFileSync(path.join(ROOT_DIR, 'guardrails.config.json'), configFile);
  }

  console.log(isUninstall ? '✓ Guardrails removed.' : '✓ Guardrails installed.');
  console.log(`  Settings: ${settingsFile}`);
  if (saved) console.log(`  Backup:   ${saved}`);
  if (!isUninstall) {
    if (RELOCATED) {
      console.log(`  Installed to: ${ROOT_DIR}`);
      console.log('                (copied out of the npx cache so the hooks keep working)');
    }
    console.log(`  Config:   ${configFile}`);
    console.log(`  Scope:    ${isGlobal ? 'all projects on this machine' : process.cwd()}`);
    console.log('\nRestart Claude Code (or run /hooks) to load them.');
  }
}

main();
