/**
 * rules.mjs — the built-in threat catalogue.
 *
 * Each rule carries the message Claude will read after being blocked, so the
 * wording matters: it should name a safe alternative. A block that only says
 * "no" invites the agent to retry the same idea in a different shape.
 */

/** Commands that are refused outright. */
export const DESTRUCTIVE = [
  {
    id: 'rm-rf-root',
    // `/`, `/*`, `~`, `~/`, `$HOME`, `C:\` — the unrecoverable targets.
    pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+(\/|\/\*|~\/?|\$HOME\/?|[A-Za-z]:[\\/]?)(\s|$)/i,
    message:
      'Recursive delete of a filesystem root or home directory. If you need to clear a directory, name it explicitly and stay inside the project.',
  },
  {
    id: 'rm-rf-parent',
    pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+.*\.\.\//i,
    message:
      'Recursive delete reaching outside the project via "..". Use a path anchored at the project root.',
  },
  {
    id: 'git-force-push',
    pattern: /\bgit\s+push\b(?=.*(--force(?!-with-lease)|(^|\s)-f(\s|$)))/i,
    message:
      'Force push discards remote history. Use "git push --force-with-lease", or push to a new branch and open a PR.',
  },
  {
    id: 'git-hard-reset',
    pattern: /\bgit\s+reset\s+(--hard|--merge)\b/i,
    message:
      'Hard reset destroys uncommitted work. Use "git stash" to set changes aside, or "git restore <path>" for specific files.',
  },
  {
    id: 'git-clean-force',
    pattern: /\bgit\s+clean\b.*-[a-z]*f/i,
    message:
      'git clean -f permanently deletes untracked files. Run "git clean -n" first and confirm the list with the user.',
  },
  {
    id: 'git-history-rewrite',
    pattern: /\bgit\s+(filter-branch|filter-repo)\b|\bgit\s+update-ref\s+-d\b/i,
    message: 'History rewriting is destructive and unreviewable. Ask the user to run this manually.',
  },
  {
    id: 'sql-drop',
    pattern: /\b(drop\s+(database|table|schema)|truncate\s+table)\b/i,
    message:
      'Destructive SQL against a live database. Write it as a reviewed migration file instead of executing it ad hoc.',
  },
  {
    id: 'disk-write',
    pattern: /\b(mkfs(\.\w+)?|fdisk|diskpart)\b|\bdd\s+[^|]*\bof=\/dev\//i,
    message: 'Raw disk or filesystem write. This is never an appropriate action for an agent.',
  },
  {
    id: 'pipe-to-shell',
    pattern: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/i,
    message:
      'Piping a downloaded script straight into a shell executes unreviewed remote code. Download it, read it, then run it.',
  },
  {
    id: 'chmod-777-root',
    pattern: /\bchmod\s+(-R\s+)?777\s+(\/|~|\$HOME)(\s|$)/i,
    message: 'Making the filesystem root world-writable. Scope the permission change to one path.',
  },
  {
    id: 'fork-bomb',
    pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,
    message: 'Fork bomb.',
  },
  {
    id: 'windows-recursive-delete',
    pattern:
      /\b(Remove-Item|ri|rd|rmdir|del)\b.*(-Recurse|\/s)\b.*\b([A-Za-z]:[\\/]?(\s|$)|\$env:USERPROFILE|%USERPROFILE%)/i,
    message:
      'Recursive delete of a drive root or user profile. Scope the deletion to a project subdirectory.',
  },
  {
    id: 'publish-package',
    pattern: /\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/i,
    message:
      'Publishing a package is public and irreversible. The user must run this themselves after reviewing the build.',
  },
  {
    id: 'infra-destroy',
    pattern:
      /\bterraform\s+(destroy|apply)\b|\bkubectl\s+delete\s+(namespace|ns|all)\b|\baws\s+\S+\s+delete-/i,
    message:
      'Destructive infrastructure change. Produce a plan for the user to review and apply themselves.',
  },
  {
    id: 'history-wipe',
    pattern: /\b(history\s+-c|shred\b|srm\b)/i,
    message: 'Clearing shell history or shredding files removes the audit trail.',
  },
];

/** Commands allowed, but never silently — the human gets a prompt. */
export const NEEDS_CONFIRMATION = [
  {
    id: 'git-push',
    pattern: /\bgit\s+push\b/i,
    message: 'Pushing to a remote.',
  },
  {
    id: 'package-install-global',
    pattern: /\b(npm|pnpm|yarn)\s+(i|install|add)\b.*(-g|--global)\b/i,
    message: 'Installing a package globally changes the machine, not the project.',
  },
  {
    id: 'service-control',
    pattern: /\b(systemctl|service|sc\.exe|Stop-Service|Restart-Service)\b/i,
    message: 'Starting or stopping a system service.',
  },
  {
    id: 'docker-prune',
    pattern: /\bdocker\s+(system\s+)?prune\b|\bdocker\s+volume\s+rm\b/i,
    message: 'Pruning Docker reclaims volumes that may hold the only copy of local data.',
  },
  {
    id: 'env-var-export-secret',
    pattern: /\b(export|setx|\$env:)\s*\w*(TOKEN|SECRET|PASSWORD|API_?KEY)/i,
    message: 'Writing a credential into the environment.',
  },
];
