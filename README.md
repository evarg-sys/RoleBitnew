# RoleBit

RoleBit is a full-stack project collaboration app with:
- Backend API: Express + LMDB at http://localhost:3000
- Frontend: static HTML/CSS/JS in site/frontend
- GitHub integration: GitHub App endpoints under /api/github

This guide covers full setup from clone to first run, plus Git setup for Windows line endings and secret safety.

Prerequisites
- Git 2.40+
- Node.js 18+ and npm
- VS Code (recommended)
- Optional: ngrok for GitHub webhook testing

1) Clone and open
- Clone the repo:
	git clone https://github.com/<your-org-or-user>/RoleBit.git
- Enter the project folder:
	cd RoleBit

2) Git setup (important)
This repo includes .gitattributes to keep code/config files in LF and avoid CRLF warning noise on Windows.

Recommended one-time global config:
- git config --global core.autocrlf true
- git config --global core.safecrlf warn

Apply normalization once after pull/clone:
- git add --renormalize .

If you ever see line-ending warnings again, run:
- git add --renormalize .

3) Install dependencies
Install root/site dependencies:
- npm --prefix site install

Install backend dependencies:
- npm --prefix site/backend install

4) Environment setup
- Copy the backend env template:
	copy site\\backend\\.env.example site\\backend\\.env

- Edit site/backend/.env and set real values:
	- GITHUB_APP_ID
	- GITHUB_APP_NAME
	- GITHUB_PRIVATE_KEY_FILE (preferred) OR GITHUB_PRIVATE_KEY
	- GITHUB_WEBHOOK_SECRET
	- GITHUB_CLIENT_ID
	- GITHUB_CLIENT_SECRET
	- APP_BASE_URL
	- ADMIN_USERNAMES
	- Optional security values like CORS_ORIGINS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX

Strong recommendation for private key handling
- Do not paste multiline keys into tracked files.
- Store your key as a local file outside Git and set GITHUB_PRIVATE_KEY_FILE in site/backend/.env.
- Keep .env untracked (already ignored).
- Never commit .pem, .key, or secret files.

5) Start the app
Backend (required):
- npm --prefix site/backend start

Frontend options:
- Option A (simple local static host): use VS Code Live Server in site/frontend and open index.html
- Option B (if your site server is used): npm --prefix site start

Default URLs
- Backend API: http://localhost:3000
- Frontend (Live Server default): http://localhost:5500

6) Verify core flow
- Open frontend signin/signup page.
- Create user, sign in, open dashboard.
- Create project from Add Project.
- Open Profile and save changes.
- Confirm top notifications appear for successful operations.

7) Optional GitHub integration setup
- Create/configure GitHub App in GitHub settings.
- Set callback and webhook URLs that match your environment.
- For local webhook tests, expose backend with ngrok:
	ngrok http 3000
- Update GitHub App webhook URL to your ngrok URL + /api/github/webhook

8) Security checklist before commit/push
- git status
- Ensure no secret files are staged.
- Ensure .env is not tracked.
- Ensure .pem/.key are not tracked.

If a key was ever committed or pushed
1. Rotate the key immediately in GitHub App settings.
2. Remove the old file from tracking:
	 git rm --cached path/to/key.pem
3. Commit the removal and push.
4. If the secret exists in history on remote, rewrite history with git filter-repo or BFG, then force-push.

9) Useful commands
- Start backend: npm --prefix site/backend start
- Start site server: npm --prefix site start
- Renormalize line endings: git add --renormalize .
- Show staged files: git status --short

Project structure
- site/backend/server.js: API server entrypoint
- site/backend/routes: API routes
- site/backend/controllers: request handlers
- site/backend/services: LMDB and GitHub services
- site/frontend: static UI pages and scripts

Troubleshooting
- Port 3000 busy:
	- Find and stop process using port 3000, then restart backend.
- Frontend cannot reach backend:
	- Verify backend is running at http://localhost:3000
	- Verify CORS_ORIGINS includes your frontend origin
- Git line-ending warnings:
	- Pull latest .gitattributes
	- Run git add --renormalize .
