const fs = require("fs");
const path = require("path");

const USERS_FILE = path.join(__dirname, "..", "users.json");

function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function resolveUsername(req) {
  return String(
    req.headers["x-rolebit-user"] || req.query.username || req.body?.username || ""
  ).trim();
}

function requireAuth(req, res, next) {
  const username = resolveUsername(req);
  if (!username) {
    return res.status(401).json({ error: "username is required" });
  }

  const users = loadUsers();
  const exists = users.some((user) => String(user.username || "").trim() === username);
  if (!exists) {
    return res.status(403).json({ error: "Unknown user" });
  }

  req.authUser = username;
  next();
}

module.exports = {
  requireAuth,
  resolveUsername
};
