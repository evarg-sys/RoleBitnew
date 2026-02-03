# Copilot Instructions for RoleBit

## Project Overview
RoleBit is an AI-powered collaboration platform for group project management. It's a full-stack web application with:
- **Backend**: Express.js API running on port 3000 with user authentication
- **Frontend**: Vanilla HTML/CSS/JavaScript with a sidebar-based navigation and auth state via localStorage
- **Data**: User credentials stored in JSON file (`users.json`)

## Architecture & Key Patterns

### Backend (`site/backend/`)
- **Framework**: Express.js with CORS and JSON body parsing
- **API Endpoints**:
  - `POST /signup`: Creates user with `{username, password, email?, firstName?, lastName?, university?}`
  - `POST /login`: Authenticates and returns `{success: true, username}`
- **Data Storage**: JSON-based persistence (no database) - reads/writes to `users.json`
- **Convention**: All endpoints accept JSON, return JSON responses with `{success: bool}` or `{error: string}`
- **Port**: 3000 (hardcoded)

### Frontend (`site/frontend/`)
- **Auth Pattern**: Uses `localStorage.setItem("rolebit_user", username)` to persist logged-in state
- **Admin Feature**: Hardcoded admin password "meow1010" stored in `script.js` - sets `localStorage.rolebit_admin`
- **Protected Pages**: Dashboard and projects require authentication; redirect to signin.html if not logged in
- **File Naming Issue**: `script .js` has a trailing space in filename - use exact path when referencing
- **API Base URL**: `http://localhost:3000` (hardcoded in script.js)
- **CSS Architecture**: Single global stylesheet (`style.css`) with:
  - Collapsible sidebar (70px default, 220px on hover)
  - Dark theme with radial gradients (`#14151a` to `#0b0c10`)
  - Glassmorphism effects (backdrop-filter blur)
  - Animation library using `@keyframes` (fadeInScale, slideDown, float)
  - Poppins font family

### Page Structure
- **index.html**: Landing page with hero section, sidebar, admin unlock interface
- **signin.html / signup.html**: Auth forms, both use `login()` and `signup()` functions
- **coming-soon.html**: Post-login welcome page showing username, displays dashboard coming soon
- **dashboard.html, userhome.html**: Admin-only pages (protected)
- **about.html, why.html, waitlist.html**: Marketing/info pages

## Developer Workflow

### Running the Application
```bash
# Start backend (from site/backend/)
node server.js

# Frontend: Open site/frontend/index.html in browser
# The backend must be running at http://localhost:3000
```

### Testing Authentication Flow
1. Navigate to index.html
2. Go to Sign Up (`/signup.html`), create account
3. Login redirects to `coming-soon.html` with username displayed
4. Admin unlock: Click "🔐 Admin" → enter "meow1010" → redirects to dashboard

### Adding New API Endpoints
- Follow the pattern: `app.post("/endpoint", (req, res) => { ... })`
- Validate inputs, return `{success: true}` or `{error: "message"}`
- Remember to update frontend's `const API` if port/URL changes

### Frontend Form Convention
- Input IDs: `user`, `pass`, `email`, `firstName`, `lastName`, `university` (signup)
- Input IDs: `loginUser`, `loginPass` (signin)
- Functions handle missing fields gracefully with `?.value || ""`

## Critical Conventions & Gotchas

1. **localStorage Keys**: Always use exact keys:
   - `"rolebit_user"` - logged-in username
   - `"rolebit_admin"` - admin flag (string "true")
   
2. **Hardcoded Values**:
   - Admin password: "meow1010" in `script .js`
   - Backend URL: "http://localhost:3000" in `script .js`
   - Backend port: 3000 in `server.js`
   
3. **File Path Gotcha**: `script .js` has trailing space - don't rename without updating all HTML references

4. **Password Security**: Currently stores plaintext passwords in JSON - this is development-only; production requires hashing (bcrypt)

5. **CORS**: Enabled globally (`app.use(cors())`) - update if implementing cross-origin restrictions

6. **Optional Signup Fields**: Backend accepts `email, firstName, lastName, university` but doesn't require them - frontend signup can be extended to capture these

## Integration Points

- **Frontend ↔ Backend**: Fetch API calls to `http://localhost:3000` endpoints
- **State Management**: Entirely localStorage-based; no session management
- **Redirects**: Used for auth flows (`signin.html` ← → `coming-soon.html` ← → `dashboard.html`)
- **Admin Access**: Only checked client-side; add server-side validation if implementing real admin features

## Useful Extensions

When modifying the codebase:
- Update both HTML form input IDs AND the JavaScript function parameters
- Test full auth flow after changes (signup → login → logout)
- Ensure new pages include sidebar with navigation
- Maintain the dark theme gradient and animation patterns
