/**
 * config.mjs — defaults plus the user's overrides.
 *
 * Config is resolved once per hook process. Lookup walks up from the session
 * cwd so a monorepo package inherits the repo-root policy, and a project-level
 * file wins over the global one.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULTS = {
  /** Master switch — set false to neutralize every hook without uninstalling. */
  enabled: true,

  bashGuard: {
    enabled: true,
    /** Branches that must never be force-pushed or hard-reset. */
    protectedBranches: ['main', 'master', 'production', 'release'],
    /** Extra regex sources (strings) appended to the built-in deny list. */
    extraDenyPatterns: [],
    /** Regex sources that override a block — your escape hatch. */
    allowPatterns: [],
  },

  pathGuard: {
    enabled: true,
    /** Never writable by the agent. */
    deny: [
      '.env',
      '.env.*',
      '**/.env',
      '**/.env.*',
      '.git/**',
      '**/.git/**',
      '**/id_rsa',
      '**/id_ed25519',
      '**/*.pem',
      '**/*.key',
      '**/*.pfx',
      '**/.npmrc',
      '**/.pypirc',
      '**/.aws/**',
      '**/.ssh/**',
      '**/node_modules/**',
      '**/.venv/**',
    ],
    /** Writable, but always ask the human first. */
    confirm: [
      '**/package-lock.json',
      '**/pnpm-lock.yaml',
      '**/yarn.lock',
      '**/poetry.lock',
      '**/Cargo.lock',
      '**/*.tf',
      '**/*.tfstate',
      '**/Dockerfile',
      '**/docker-compose*.yml',
      '**/.github/workflows/**',
      '**/migrations/**',
    ],
    /** Exempt from both lists — checked first. */
    allow: ['**/.env.example', '**/.env.sample', '**/.env.template'],
  },

  secretScan: {
    enabled: true,
    /** Regex sources for strings that are fine despite looking like secrets. */
    ignorePatterns: [
      'EXAMPLE',
      'PLACEHOLDER',
      'YOUR_.*_HERE',
      'xxx+',
      '\\.\\.\\.',
      '<[a-z_]+>',
    ],
    /** File globs the scanner skips entirely. */
    skipPaths: ['**/*.test.*', '**/*.spec.*', '**/fixtures/**', '**/__mocks__/**'],
  },

  formatOnWrite: {
    enabled: true,
    /** extension -> command template; {file} is substituted. Skipped when the
     *  binary is absent, so this is inert until you actually have the tool. */
    formatters: {
      '.js': 'npx --no-install prettier --write {file}',
      '.jsx': 'npx --no-install prettier --write {file}',
      '.ts': 'npx --no-install prettier --write {file}',
      '.tsx': 'npx --no-install prettier --write {file}',
      '.json': 'npx --no-install prettier --write {file}',
      '.css': 'npx --no-install prettier --write {file}',
      '.md': 'npx --no-install prettier --write {file}',
      '.py': 'python -m black {file}',
      '.go': 'gofmt -w {file}',
      '.rs': 'rustfmt {file}',
    },
    timeoutMs: 15000,
  },

  testGate: {
    enabled: false, // opt-in: it runs your suite on every turn end
    /** Shell command that must exit 0 before Claude is allowed to stop. */
    command: 'npm test',
    timeoutMs: 120000,
    /** Hard cap on consecutive blocks, so a permanently red suite cannot
     *  trap the session in a loop. */
    maxRetries: 2,
  },

  sessionContext: {
    enabled: true,
    includeGitStatus: true,
    includeRecentCommits: 5,
  },

  auditLog: {
    enabled: true,
    /** Relative to the project root. */
    file: '.claude/guardrails-audit.jsonl',
    /** Tool names to record; '*' records everything. */
    tools: ['Bash', 'Write', 'Edit', 'NotebookEdit'],
    maxBytes: 5_000_000,
  },
};

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object'
        ? deepMerge(out[key], value)
        : value;
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const CONFIG_NAME = 'guardrails.config.json';

/** Nearest `.claude/guardrails.config.json` at or above `startDir`. */
function findProjectConfig(startDir) {
  let dir = startDir;
  for (let depth = 0; depth < 25 && dir; depth++) {
    const candidate = path.join(dir, '.claude', CONFIG_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Effective config: defaults <- global <- project.
 * `projectDir` is the directory holding the winning `.claude/`, which the
 * audit log and path matcher both anchor to.
 */
export function loadConfig(cwd) {
  const start = cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let config = DEFAULTS;

  const global = path.join(os.homedir(), '.claude', CONFIG_NAME);
  if (fs.existsSync(global)) config = deepMerge(config, readJson(global) || {});

  const project = findProjectConfig(start);
  if (project) config = deepMerge(config, readJson(project) || {});

  const projectDir = project
    ? path.dirname(path.dirname(project))
    : process.env.CLAUDE_PROJECT_DIR || start;

  return { ...config, _projectDir: projectDir };
}

/** Compile regex sources, discarding any that do not compile. */
export function toRegexList(sources, flags = 'i') {
  if (!Array.isArray(sources)) return [];
  const out = [];
  for (const src of sources) {
    try {
      out.push(src instanceof RegExp ? src : new RegExp(src, flags));
    } catch {
      /* a malformed user pattern must not disarm the rest of the list */
    }
  }
  return out;
}
