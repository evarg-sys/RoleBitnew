-- Relational migration reference for GitHub App integration.
-- The current runtime in this repo uses LMDB, but this schema is provided for SQL migration parity.

CREATE TABLE IF NOT EXISTS github_installations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  workspace_id TEXT,
  project_id TEXT,
  github_installation_id INTEGER NOT NULL,
  github_account_login TEXT NOT NULL,
  github_account_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (github_installation_id, user_id, workspace_id, project_id)
);

CREATE TABLE IF NOT EXISTS github_repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id INTEGER NOT NULL,
  github_repo_id INTEGER NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  private INTEGER NOT NULL DEFAULT 0,
  html_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (installation_id, github_repo_id),
  FOREIGN KEY (installation_id) REFERENCES github_installations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS github_commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  sha TEXT NOT NULL,
  branch TEXT NOT NULL,
  message TEXT NOT NULL,
  author_name TEXT,
  author_email TEXT,
  author_avatar_url TEXT,
  committed_at TEXT,
  compare_url TEXT,
  raw_payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (repository_id, sha),
  FOREIGN KEY (repository_id) REFERENCES github_repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS github_commit_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  status TEXT,
  additions INTEGER DEFAULT 0,
  deletions INTEGER DEFAULT 0,
  changes INTEGER DEFAULT 0,
  patch TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (commit_id, filename),
  FOREIGN KEY (commit_id) REFERENCES github_commits(id) ON DELETE CASCADE
);
