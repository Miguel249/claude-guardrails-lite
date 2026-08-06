#!/usr/bin/env node
/**
 * guard-bash — PreToolUse on Bash.
 *
 * Inspects every shell command before it runs and either refuses it, escalates
 * it to a human prompt, or stays out of the way.
 *
 * Configure with: hooks.PreToolUse[matcher="Bash"]
 */

import { readInput, denyTool, askTool, pass, safely } from '../lib/io.mjs';
import { loadConfig, toRegexList } from '../lib/config.mjs';
import { splitCommands, stripPrefixes } from '../lib/match.mjs';
import { DESTRUCTIVE, NEEDS_CONFIRMATION } from '../lib/rules.mjs';

await safely(async () => {
  const input = await readInput();
  if (input.tool_name !== 'Bash') pass();

  const config = loadConfig(input.cwd);
  if (!config.enabled || !config.bashGuard?.enabled) pass();

  const command = input.tool_input?.command;
  if (!command) pass();

  // An explicit allow beats every rule below — this is the documented way out
  // when a project legitimately needs something the catalogue forbids.
  const allow = toRegexList(config.bashGuard.allowPatterns);
  if (allow.some((re) => re.test(command))) pass();

  // Two passes are needed. Segments catch what hides after `&&` or `;`, but
  // splitting also severs pipelines — and `curl … | sh` is only dangerous as a
  // whole. So the unsplit line is scanned alongside its parts.
  const segments = [stripPrefixes(command), ...splitCommands(command).map(stripPrefixes)];
  const extra = toRegexList(config.bashGuard.extraDenyPatterns).map((pattern, i) => ({
    id: `custom-${i}`,
    pattern,
    message: 'Blocked by a project-defined guardrail pattern.',
  }));

  for (const segment of segments) {
    for (const rule of [...DESTRUCTIVE, ...extra]) {
      // Regexes from rules.mjs are non-global, so lastIndex never carries over.
      if (rule.pattern.test(segment)) {
        denyTool(
          `Guardrails blocked this command [${rule.id}].\n\n${rule.message}\n\nBlocked segment: ${segment}`,
        );
      }
    }
  }

  // Force-pushing a feature branch is routine; force-pushing main is not.
  const branches = config.bashGuard.protectedBranches || [];
  for (const segment of segments) {
    if (!/\bgit\s+push\b/i.test(segment)) continue;
    const forced = /--force\b|--force-with-lease\b|(^|\s)-f(\s|$)/i.test(segment);
    if (!forced) continue;
    const hit = branches.find((b) =>
      new RegExp(`(^|[\\s:/])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|:)`, 'i').test(segment),
    );
    if (hit) {
      denyTool(
        `Guardrails blocked a force push to the protected branch "${hit}".\n\n` +
          `Push to a feature branch and open a pull request instead.\n\nBlocked segment: ${segment}`,
      );
    }
  }

  for (const segment of segments) {
    for (const rule of NEEDS_CONFIRMATION) {
      if (rule.pattern.test(segment)) {
        askTool(`Guardrails wants a human decision [${rule.id}].\n\n${rule.message}\n\nCommand: ${segment}`);
      }
    }
  }

  pass();
});
