const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { DatabaseSync } = require("node:sqlite");

const app = express();
app.use(cors());
app.use(express.json());

const USERS_FILE = path.join(__dirname, "users.json");
const DB_FILE = path.join(__dirname, "rolebit.db");

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, "[]", "utf8");
}

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  owner_username TEXT NOT NULL,
  summary TEXT DEFAULT '',
  status TEXT DEFAULT 'In Progress',
  deadline TEXT DEFAULT '',
  progress INTEGER DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  team TEXT DEFAULT 'Team: 1 person',
  priority TEXT DEFAULT 'Priority: Medium',
  risk TEXT DEFAULT 'Risk: None',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  task TEXT NOT NULL,
  task_owner TEXT DEFAULT '',
  due TEXT DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0,
  completed_by TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, username),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
`);

function hasColumn(tableName, columnName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some((row) => row.name === columnName);
}

function ensureProjectSchema() {
  if (!hasColumn("projects", "lifecycle_stage")) {
    db.exec("ALTER TABLE projects ADD COLUMN lifecycle_stage TEXT DEFAULT 'Planning'");
  }
  if (!hasColumn("projects", "course")) {
    db.exec("ALTER TABLE projects ADD COLUMN course TEXT DEFAULT 'General Studies'");
  }
  if (!hasColumn("projects", "git_repo_url")) {
    db.exec("ALTER TABLE projects ADD COLUMN git_repo_url TEXT DEFAULT ''");
  }
  if (!hasColumn("projects", "git_branch")) {
    db.exec("ALTER TABLE projects ADD COLUMN git_branch TEXT DEFAULT 'main'");
  }
  if (!hasColumn("projects", "git_notes")) {
    db.exec("ALTER TABLE projects ADD COLUMN git_notes TEXT DEFAULT ''");
  }
}

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

function getMembersByProjectId(projectId) {
  return db.prepare(`
    SELECT username
    FROM project_members
    WHERE project_id = ?
    ORDER BY username ASC
  `).all(projectId).map((row) => row.username);
}

function setMembersForProject(projectId, members, ownerUsername) {
  const safeMembers = Array.isArray(members) ? members : [];
  const normalized = new Set();

  safeMembers.forEach((member) => {
    const value = String(member || "").trim();
    if (value) normalized.add(value);
  });

  if (ownerUsername) {
    normalized.add(String(ownerUsername).trim());
  }

  db.prepare("DELETE FROM project_members WHERE project_id = ?").run(projectId);

  const insertStmt = db.prepare(`
    INSERT INTO project_members (project_id, username)
    VALUES (?, ?)
  `);

  Array.from(normalized).forEach((username) => {
    insertStmt.run(projectId, username);
  });
}

function seedProjectsIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM projects").get().c;
  if (count > 0) return;

  const insertProject = db.prepare(`
    INSERT INTO projects (title, owner_username, summary, status, deadline, progress, visibility, team, priority, risk, course, git_repo_url, git_branch, git_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTimeline = db.prepare(`
    INSERT INTO project_timeline (project_id, task, task_owner, due, completed, completed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const seed = [
    {
      title: "Website Redesign",
      owner: "evarg22",
      summary: "Rebuild the landing and onboarding experience with improved conversion-focused sections.",
      status: "In Progress",
      deadline: "2026-04-22",
      progress: 68,
      visibility: "shared",
      team: "Team: 5 people",
      priority: "Priority: High",
      risk: "Risk: Tight content timeline",
      course: "Computer Science",
      gitRepoUrl: "",
      gitBranch: "main",
      gitNotes: "",
      timeline: [
        ["Finalize hero interaction", "Ari", "Apr 18", 1, "Ari"],
        ["Approve mobile QA", "Nina", "Apr 20", 1, "Nina"],
        ["Publish v2 content", "Theo", "Apr 22", 0, ""]
      ]
    },
    {
      title: "API Integration",
      owner: "evarg22",
      summary: "Connect billing, analytics, and user event pipelines into a single service layer.",
      status: "In Progress",
      deadline: "2026-04-27",
      progress: 42,
      visibility: "private",
      team: "Team: 3 people",
      priority: "Priority: Medium",
      risk: "Risk: Payment retries",
      course: "Software Engineering",
      gitRepoUrl: "",
      gitBranch: "main",
      gitNotes: "",
      timeline: [
        ["Finish payment webhook", "Eric", "Apr 21", 1, "Eric"],
        ["Audit API logs", "Marta", "Apr 24", 0, ""],
        ["Run staging tests", "Devon", "Apr 27", 0, ""]
      ]
    }
  ];

  seed.forEach((project) => {
    const result = insertProject.run(
      project.title,
      project.owner,
      project.summary,
      project.status,
      project.deadline,
      project.progress,
      project.visibility,
      project.team,
      project.priority,
      project.risk,
      project.course,
      project.gitRepoUrl,
      project.gitBranch,
      project.gitNotes
    );

    project.timeline.forEach((step) => {
      insertTimeline.run(result.lastInsertRowid, step[0], step[1], step[2], step[3], step[4]);
    });
  });
}

function getTimelineByProjectId(projectId) {
  return db.prepare(`
    SELECT id, task, task_owner, due, completed, completed_by
    FROM project_timeline
    WHERE project_id = ?
    ORDER BY id ASC
  `).all(projectId).map((row) => ({
    id: row.id,
    task: row.task,
    owner: row.task_owner || "",
    due: row.due || "",
    completed: Boolean(row.completed),
    completedBy: row.completed_by || ""
  }));
}

function projectRowToResponse(row) {
  return {
    id: row.id,
    title: row.title,
    ownerUsername: row.owner_username,
    summary: row.summary,
    status: row.status,
    deadline: row.deadline,
    progress: row.progress,
    visibility: row.visibility,
    team: row.team,
    priority: row.priority,
    risk: row.risk,
    course: row.course || "General Studies",
    gitRepoUrl: row.git_repo_url || "",
    gitBranch: row.git_branch || "main",
    gitNotes: row.git_notes || "",
    lifecycleStage: row.lifecycle_stage || "Planning",
    members: getMembersByProjectId(row.id),
    timeline: getTimelineByProjectId(row.id)
  };
}

ensureProjectSchema();
seedProjectsIfEmpty();

app.post("/signup", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

  const users = readUsers();
  if (users.find((u) => u.username === username)) {
    return res.status(400).json({ error: "User already exists" });
  }

  users.push({ username, password });
  saveUsers(users);
  res.json({ success: true });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const users = readUsers();
  const user = users.find((u) => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: "Invalid login" });
  res.json({ success: true, username });
});

app.get("/users", (_req, res) => {
  const users = readUsers()
    .map((item) => String(item.username || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  res.json({ users });
});

app.get("/projects", (req, res) => {
  const username = String(req.query.username || "").trim();
  if (!username) {
    return res.status(400).json({ error: "username query parameter is required" });
  }

  const rows = db.prepare(`
    SELECT *
    FROM projects
    WHERE owner_username = ?
      OR visibility = 'shared'
      OR EXISTS (
        SELECT 1
        FROM project_members pm
        WHERE pm.project_id = projects.id AND pm.username = ?
      )
    ORDER BY datetime(updated_at) DESC, id DESC
  `).all(username, username);

  res.json({ projects: rows.map(projectRowToResponse) });
});

app.get("/projects/:id", (req, res) => {
  const projectId = Number(req.params.id);
  const username = String(req.query.username || "").trim();

  if (!username) {
    return res.status(400).json({ error: "username query parameter is required" });
  }

  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!row) return res.status(404).json({ error: "Project not found" });

  const canAccess =
    row.owner_username === username ||
    row.visibility === "shared" ||
    db.prepare("SELECT 1 AS ok FROM project_members WHERE project_id = ? AND username = ? LIMIT 1").get(projectId, username);

  if (!canAccess) {
    return res.status(403).json({ error: "Access denied" });
  }

  res.json({ project: projectRowToResponse(row) });
});

app.post("/projects", (req, res) => {
  const {
    username,
    title,
    summary = "",
    status = "In Progress",
    deadline = "",
    progress = 0,
    visibility = "private",
    lifecycleStage = "Planning",
    members = [],
    team = "Team: 1 person",
    priority = "Priority: Medium",
    risk = "Risk: None",
    course = "General Studies",
    gitRepoUrl = "",
    gitBranch = "main",
    gitNotes = "",
    timeline = []
  } = req.body;

  if (!username || !title) {
    return res.status(400).json({ error: "username and title are required" });
  }

  const safeVisibility = visibility === "shared" ? "shared" : "private";
  const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));

  const result = db.prepare(`
    INSERT INTO projects (title, owner_username, summary, status, deadline, progress, visibility, lifecycle_stage, team, priority, risk, course, git_repo_url, git_branch, git_notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(title, username, summary, status, deadline, safeProgress, safeVisibility, lifecycleStage, team, priority, risk, course, gitRepoUrl, gitBranch, gitNotes);

  setMembersForProject(result.lastInsertRowid, members, username);

  if (Array.isArray(timeline) && timeline.length) {
    const insertTimeline = db.prepare(`
      INSERT INTO project_timeline (project_id, task, task_owner, due, completed, completed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    timeline.forEach((item) => {
      if (!item || !item.task) return;
      insertTimeline.run(
        result.lastInsertRowid,
        String(item.task),
        String(item.owner || ""),
        String(item.due || ""),
        item.completed ? 1 : 0,
        String(item.completedBy || "")
      );
    });
  }

  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(result.lastInsertRowid);
  res.json({ success: true, project: projectRowToResponse(row) });
});

app.put("/projects/:id", (req, res) => {
  const projectId = Number(req.params.id);
  const {
    username,
    title,
    summary,
    status,
    deadline,
    progress,
    visibility,
    lifecycleStage,
    members,
    team,
    priority,
    risk,
    course,
    gitRepoUrl,
    gitBranch,
    gitNotes
  } = req.body;

  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!existing) return res.status(404).json({ error: "Project not found" });
  if (!username || existing.owner_username !== username) {
    return res.status(403).json({ error: "Only the owner can edit this project" });
  }

  const safeVisibility = visibility === "shared" ? "shared" : "private";
  const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));

  db.prepare(`
    UPDATE projects
    SET title = ?, summary = ?, status = ?, deadline = ?, progress = ?, visibility = ?,
      lifecycle_stage = ?, team = ?, priority = ?, risk = ?, course = ?, git_repo_url = ?, git_branch = ?, git_notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    String(title || existing.title),
    String(summary || ""),
    String(status || "In Progress"),
    String(deadline || ""),
    safeProgress,
    safeVisibility,
    String(lifecycleStage || "Planning"),
    String(team || "Team: 1 person"),
    String(priority || "Priority: Medium"),
    String(risk || "Risk: None"),
    String(course || "General Studies"),
    String(gitRepoUrl || ""),
    String(gitBranch || "main"),
    String(gitNotes || ""),
    projectId
  );

  if (Array.isArray(members)) {
    setMembersForProject(projectId, members, existing.owner_username);
  }

  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  res.json({ success: true, project: projectRowToResponse(row) });
});

app.put("/projects/:id/timeline", (req, res) => {
  const projectId = Number(req.params.id);
  const { username, timeline } = req.body;

  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!existing) return res.status(404).json({ error: "Project not found" });
  if (!username || existing.owner_username !== username) {
    return res.status(403).json({ error: "Only the owner can edit timeline" });
  }

  if (!Array.isArray(timeline)) {
    return res.status(400).json({ error: "timeline must be an array" });
  }

  const deleteStmt = db.prepare("DELETE FROM project_timeline WHERE project_id = ?");
  const insertStmt = db.prepare(`
    INSERT INTO project_timeline (project_id, task, task_owner, due, completed, completed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  try {
    db.exec("BEGIN");
    deleteStmt.run(projectId);
    timeline.forEach((item) => {
      if (!item || !item.task) return;
      insertStmt.run(
        projectId,
        String(item.task),
        String(item.owner || ""),
        String(item.due || ""),
        item.completed ? 1 : 0,
        String(item.completedBy || "")
      );
    });
    db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: "Failed to update timeline" });
  }

  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  res.json({ success: true, project: projectRowToResponse(row) });
});

app.listen(3000, () => {
  console.log("Backend running on http://localhost:3000");
});
