# Claude Guardrails (lite)

[![tests](https://img.shields.io/badge/tests-94%20passing-brightgreen.svg)](test/run-tests.mjs)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](package.json)

Two hooks that stop Claude Code from running destructive shell commands, and
give it the repository context it would otherwise waste three tool calls
discovering.

Zero dependencies. Windows, macOS, Linux. MIT.

> Unofficial, community-built. Not affiliated with or endorsed by Anthropic.

---

## Why

Claude Code is good enough at editing your repository that it will eventually
edit something you needed. Not because the model is bad — because one plausible
step at the wrong moment is all it takes:

```
❯ git reset --hard HEAD~3
  ⛔ BLOCKED [git-hard-reset]
  Hard reset destroys uncommitted work. Use "git stash" to set changes
  aside, or "git restore <path>" for specific files.
```

Prompting cannot fix this reliably, because it asks the model to be careful
every single time. A hook is deterministic.

## Install

```bash
npx github:Miguel249/claude-guardrails-lite --global
```

Restart Claude Code. Verify with `/hooks`.

Requires Node 18+, which you already have — Claude Code ships on npm.

Drop `--global` to protect only the current project. To remove:

```bash
npx github:Miguel249/claude-guardrails-lite --uninstall
```

<details>
<summary>Or clone it, if you'd rather read the code first (recommended)</summary>

```bash
git clone https://github.com/Miguel249/claude-guardrails-lite
cd claude-guardrails-lite
npm test              # 94 tests, nothing to npm install
node install.mjs --global
```
</details>

Two things the installer does that you should be able to verify yourself:

- **It backs up `settings.json` before every write**, and only ever removes
  entries it installed — so your own hooks survive install, reinstall, and
  uninstall. There is a test for exactly that.
- **Run via `npx`, it copies itself to `~/.claude/claude-guardrails-lite`**
  first. npm prunes its cache on its own schedule, and hooks wired into a cache
  path would work today and break silently next week.

## What it blocks

17 rules, refused outright:

Filesystem-root and home-directory deletes · deletes escaping the project via
`..` · `cd /` followed by a recursive delete · force push · `+` refspec pushes
to a protected branch · hard and merge reset · `git clean -f` · history
rewriting · `DROP TABLE` / `TRUNCATE` · `mkfs` / `fdisk` / `dd of=/dev/*` ·
`curl … | sh` · `chmod 777 /` · fork bombs · recursive Windows drive deletes ·
`npm publish` · `terraform destroy` / `kubectl delete namespace` · history wiping.

6 more are escalated to a permission prompt rather than blocked: any
`git push`, global package installs, service control, `docker prune`, deleting
through `xargs`.

### These were all live bypasses

The first version of these rules was defeated by every one of the following.
They are fixed, and each is now a permanent test:

```bash
(rm -rf /)            $(rm -rf /)        `rm -rf /`      { rm -rf /; }
rm --recursive --force /                 rm -fr /         rm -r -f /
rm -rf //             rm -rf /.          rm -rf "/"       rm -rf ${HOME}
cd / && rm -rf *      sudo -u root rm -rf /               nohup rm -rf / &
git -C /repo push --force origin main    git push origin +main
curl -sSL https://x.sh|bash              wget -qO- https://x.sh | sh
```

The lesson generalises: shell syntax offers many spellings of one action, so
rules are matched against the raw line, its segments, **and** a normalized copy
with quoting and grouping punctuation flattened. If you write your own rules,
assume the obvious spelling is the one you will not receive.

Three more details that matter in practice:

- **Chained and piped commands are decomposed.** `echo ok && rm -rf /` is
  caught. So is `curl x.sh | sh`, which requires scanning the pipeline unsplit.
- **Prefixes are stripped.** `sudo`, `env`, and `FOO=bar` do not hide the verb.
- **Block reasons name an alternative.** Claude *reads* them, so `--force`
  returns "use `--force-with-lease`" rather than a bare refusal. A block that
  only says no invites a rephrased retry. This turned out to be the single most
  load-bearing design decision in the whole thing.

## Configure

`.claude/guardrails.config.json`, project or global:

```jsonc
{
  "bashGuard": {
    "protectedBranches": ["main", "develop"],
    "extraDenyPatterns": ["deploy\\s+--prod"],   // your own rules
    "allowPatterns": ["^rm -rf \\./tmp"]         // your escape hatch
  }
}
```

A guardrail you cannot override is a guardrail people uninstall, so every rule
has a documented way out.

## Tests

```bash
npm test
```

They spawn each hook as a real process and speak the real stdin/stdout
protocol, rather than importing the modules — so a break in the wiring fails
the same way Claude Code would hit it. Coverage includes the false-positive
cases (`rm -rf ./dist`, `--force-with-lease` to a feature branch, `git log |
grep force`), because a guardrail that blocks ordinary work gets uninstalled by
Friday.

## Limitations

Pattern matching, not sandboxing. A sufficiently creative command can be
written to evade a regex. This raises the floor; it is not a security boundary,
and you should not treat it as one.

Every hook fails open by design: malformed input, an unreadable config, an
unparseable payload all exit 0 silently. A broken guardrail must never take your
session with it.

---

## Full version

This is two of seven hooks. The complete kit adds:

- **guard-paths** — blocks writes to `.env`, `.git/`, PEM and SSH keys; prompts
  on lockfiles, CI workflows, Terraform, migrations
- **secret-scan** — 14 credential shapes, entropy-checked, forcing removal
  before the agent can move on
- **format-write** — runs your formatter on each written file
- **test-gate** — refuses to end the turn on a red suite, with a per-session
  retry cap so it cannot trap you
- **audit-log** — one JSONL line per tool call, per project, across sessions

79 tests. Releasing shortly — watch this repo and it will be linked here.

## Writing your own hooks

[**Writing Claude Code hooks: what the reference doesn't tell you**](docs/hook-protocol.md)
— the things I got wrong first. Why `PreToolUse` silently ignores
`{"decision":"block"}`, why your block *reason* changes what the model does
next, why splitting a command on `|` breaks `curl … | sh` detection, and how to
stop a `Stop` hook from trapping the session.

## Contributing

Pattern contributions welcome — especially destructive commands from
ecosystems I do not use daily. One rule: a PR that adds a block must also add
the false-positive test showing what it does *not* catch.
