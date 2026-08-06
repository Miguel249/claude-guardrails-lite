/**
 * io.mjs — stdin/stdout contract for Claude Code hooks.
 *
 * Every hook is invoked as a plain process. Claude Code writes one JSON object
 * to stdin and reads one JSON object from stdout. Exit code 0 means "stdout is
 * a decision"; any other code means the hook itself failed.
 *
 * The cardinal rule here: a broken guardrail must never break the user's
 * session. Every helper below fails open — if we cannot parse, cannot read, or
 * cannot decide, we exit 0 silently and let the tool call through.
 */

/** Read the full hook payload from stdin. Resolves to {} if anything is off. */
export async function readInput() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Emit a JSON decision and exit 0. */
export function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

/** Exit silently without a decision — the tool call proceeds untouched. */
export function pass() {
  process.exit(0);
}

/**
 * PreToolUse: refuse the tool call. Claude sees `reason` and can adapt,
 * so the reason should tell it what to do instead, not just what went wrong.
 */
export function denyTool(reason, { hookEventName = 'PreToolUse' } = {}) {
  emit({
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

/**
 * PreToolUse: force the interactive permission prompt even if the command
 * would otherwise be auto-approved. Used for "suspicious but not forbidden".
 */
export function askTool(reason, { hookEventName = 'PreToolUse' } = {}) {
  emit({
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  });
}

/** PostToolUse / Stop: the action already happened; hand Claude a correction. */
export function blockWithReason(reason) {
  emit({ decision: 'block', reason });
}

/** Inject text into Claude's context without blocking anything. */
export function addContext(text, hookEventName) {
  emit({ hookSpecificOutput: { hookEventName, additionalContext: text } });
}

/** Surface a line to the human in the transcript, without touching the flow. */
export function notifyUser(text) {
  emit({ systemMessage: text, suppressOutput: true });
}

/**
 * Wrap a hook body so an unexpected throw degrades to "allow" instead of
 * spraying a stack trace into the transcript. Debug output stays behind
 * GUARDRAILS_DEBUG so a failing guardrail is diagnosable but never noisy.
 */
export async function safely(fn) {
  try {
    await fn();
  } catch (err) {
    if (process.env.GUARDRAILS_DEBUG) {
      process.stderr.write(`[guardrails] ${err?.stack || err}\n`);
    }
    process.exit(0);
  }
}
