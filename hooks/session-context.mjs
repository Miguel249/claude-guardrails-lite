#!/usr/bin/env node
/**
 * session-context — SessionStart.
 *
 * Front-loads the repository facts Claude would otherwise spend its first three
 * tool calls discovering: branch, working-tree state, recent commits, runtime
 * versions, and which guardrails are armed.
 *
 * The guardrails summary is the important half. An agent that knows a rule
 * exists works within it; an agent that discovers it by being blocked burns a
 * turn on the collision.
 *
 * Configure with: hooks.SessionStart
 */

import { execSync } from 'node:child_process';
import { readInput, addContext, pass, safely } from '../lib/io.mjs';
import { loadConfig } from '../lib/config.mjs';

function git(args, cwd) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true,
    }).trim();
  } catch {
    return '';
  }
}

function version(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true,
    })
      .trim()
      .split('\n')[0];
  } catch {
    return null;
  }
}

await safely(async () => {
  const input = await readInput();
  const config = loadConfig(input.cwd);
  if (!config.enabled || !config.sessionContext?.enabled) pass();

  const dir = config._projectDir;
  const lines = [];

  const branch = git('rev-parse --abbrev-ref HEAD', dir);
  if (branch) {
    lines.push('## Repository');
    lines.push(`- Branch: \`${branch}\``);

    const upstream = git('rev-parse --abbrev-ref @{u}', dir);
    if (upstream) {
      const counts = git(`rev-list --left-right --count ${upstream}...HEAD`, dir);
      const [behind, ahead] = counts.split(/\s+/);
      if (ahead !== '0' || behind !== '0') {
        lines.push(`- Versus \`${upstream}\`: ${ahead} ahead, ${behind} behind`);
      }
    }

    if (config.sessionContext.includeGitStatus) {
      const status = git('status --porcelain', dir);
      const changed = status ? status.split('\n').filter(Boolean) : [];
      lines.push(
        changed.length
          ? `- Working tree: ${changed.length} uncommitted file(s)\n${changed.slice(0, 15).map((l) => `    ${l}`).join('\n')}`
          : '- Working tree: clean',
      );
    }

    const n = config.sessionContext.includeRecentCommits;
    if (n > 0) {
      const log = git(`log -${n} --pretty=format:%h%x20%s --no-merges`, dir);
      if (log) lines.push(`- Recent commits:\n${log.split('\n').map((l) => `    ${l}`).join('\n')}`);
    }
  }

  const runtimes = [
    ['Node', version('node --version')],
    ['Python', version('python --version') || version('python3 --version')],
    ['Go', version('go version')],
  ].filter(([, v]) => v);
  if (runtimes.length) {
    lines.push('');
    lines.push('## Runtimes');
    for (const [name, v] of runtimes) lines.push(`- ${name}: ${v}`);
  }

  const armed = [];
  if (config.bashGuard?.enabled) {
    armed.push(
      `destructive shell commands are blocked; force-push and hard-reset are refused on ${(config.bashGuard.protectedBranches || []).join(', ')}`,
    );
  }
  if (config.pathGuard?.enabled) armed.push('writes to .env, .git internals, and key files are blocked');
  if (config.secretScan?.enabled) armed.push('written files are scanned for credentials');
  if (config.testGate?.enabled) armed.push(`\`${config.testGate.command}\` must pass before a turn can end`);

  if (armed.length) {
    lines.push('');
    lines.push('## Guardrails active in this repository');
    for (const item of armed) lines.push(`- ${item}`);
    lines.push('');
    lines.push(
      'Work within these rules rather than around them. If one blocks something genuinely necessary, say so and let the user decide — do not look for a phrasing that evades it.',
    );
  }

  if (!lines.length) pass();
  addContext(lines.join('\n'), 'SessionStart');
});
