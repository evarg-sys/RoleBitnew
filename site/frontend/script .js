const API = "http://localhost:3000";

/* ---------- ADMIN FUNCTIONS ---------- */

function toggleAdminInput() {
  const wrapper = document.getElementById("adminWrapper");
  if (wrapper) {
    wrapper.classList.toggle("show");
    if (wrapper.classList.contains("show")) {
      document.getElementById("adminPassword").focus();
    }
  }
}

function submitAdminPassword() {
  const statusEl = document.getElementById("adminStatus");

  if (!statusEl) return;
  statusEl.innerText = "Admin access is now assigned by backend username. Sign in to continue.";
  statusEl.classList.remove("error");
  statusEl.classList.add("active");

  setTimeout(() => {
    window.location.href = "signin.html";
  }, 800);
}

function isAdmin() {
  return localStorage.getItem("rolebit_admin") === "true";
}

/* ---------- AUTH ---------- */

async function signup() {
  const username = document.getElementById("user")?.value || "";
  const password = document.getElementById("pass")?.value || "";

  // New fields (optional, won’t break old behavior)
  const email = document.getElementById("email")?.value || "";
  const firstName = document.getElementById("firstName")?.value || "";
  const lastName = document.getElementById("lastName")?.value || "";
  const university = document.getElementById("university")?.value || "";

  const res = await fetch(API + "/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      email,
      firstName,
      lastName,
      university
    })
  });

  const data = await res.json();
  if (data.error) alert(data.error);
  else alert("Account created!");
}

function login() {
  const username = document.getElementById("loginUser").value;
  const password = document.getElementById("loginPass").value;

  fetch("http://localhost:3000/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
  localStorage.setItem("rolebit_user", data.username);  // MATCH HOME PAGE

  if (data.isAdmin === true) {
    localStorage.setItem("rolebit_admin", "true");
    window.location.href = "dashboard.html";
  } else {
    localStorage.removeItem("rolebit_admin");
    window.location.href = "coming-soon.html";
  }
}
 else {
      alert("Invalid login");
    }
  })
  .catch(() => alert("Server not running"));
}


function loadUser() {
  const u = localStorage.getItem("rolebit_user");

  if (u) {
    const w = document.getElementById("welcome");
    const l = document.getElementById("logoutBtn");
    if (w) w.innerText = "Welcome, " + u;
    if (l) l.style.display = "inline";
  }

  const protectedPages = ["dashboard", "projects"];
  const isProtected = protectedPages.some(p => location.pathname.includes(p));

  if (!u && isProtected) {
    window.location.href = "signin.html";
  }
}

function logout() {
  localStorage.removeItem("rolebit_user");
  window.location.href = "signin.html";
}

function goWaitlist() {
  window.location.href = "waitlist.html";
}

function wireAuthButtons() {
  const signupBtn = document.getElementById("signupBtn");
  if (signupBtn && !signupBtn.dataset.wired) {
    signupBtn.dataset.wired = "true";
    signupBtn.addEventListener("click", signup);
  }

  const loginBtn = document.getElementById("loginBtn");
  if (loginBtn && !loginBtn.dataset.wired) {
    loginBtn.dataset.wired = "true";
    loginBtn.addEventListener("click", login);
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn && !logoutBtn.dataset.wired) {
    logoutBtn.dataset.wired = "true";
    logoutBtn.addEventListener("click", logout);
  }
}

/* ---------- YOUR EXISTING ANIMATIONS ---------- */

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.animationPlayState = "running";
    }
  });
});
document.querySelectorAll(".card").forEach(card => observer.observe(card));

function renderHeroSection() {
  const greetingEl = document.getElementById("heroGreeting");
  const taskEl = document.getElementById("heroTask");
  const projectEl = document.getElementById("heroProject");
  const ring = document.getElementById("heroProgressRing");
  const percentText = document.getElementById("heroProgressText");

  const user = localStorage.getItem("rolebit_user") || "User";

  const hour = new Date().getHours();
  let greeting;

  if (hour < 12) greeting = "Good Morning";
  else if (hour < 18) greeting = "Good Afternoon";
  else greeting = "Good Evening";

  greetingEl.innerText = `${greeting}, ${user}`;

  const nextTask = mockTimeline.find(t => t.status === "today" || t.status === "upcoming");

  if (nextTask) {
    taskEl.innerText = nextTask.task;
    projectEl.innerText = "in " + nextTask.project;
  }

  const completed = mockTimeline.filter(t => t.status === "completed").length;
  const percent = Math.round((completed / mockTimeline.length) * 100);

  percentText.innerText = percent + "%";

  const circumference = 201;
  const offset = circumference - (percent / 100) * circumference;
  ring.style.strokeDashoffset = offset;
}

renderHeroSection(); 

renderNextTask();

/* ---------- AUTO LOAD ---------- */
loadUser();
wireAuthButtons();