const API = "http://localhost:3000";

const ADMIN_PASSWORD = "meow1010";

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
  const password = document.getElementById("adminPassword").value;
  const statusEl = document.getElementById("adminStatus");
  
  if (password === ADMIN_PASSWORD) {
    localStorage.setItem("rolebit_admin", "true");
    statusEl.innerText = "✓ Unlocked";
    statusEl.classList.add("active");
    statusEl.classList.remove("error");
    
    // Redirect to dashboard if not already there
    if (!location.pathname.includes("dashboard")) {
      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 500);
    }
  } else {
    statusEl.innerText = "✗ Wrong password";
    statusEl.classList.add("error");
    statusEl.classList.remove("active");
    document.getElementById("adminPassword").value = "";
  }
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
  window.location.href = "coming-soon.html";
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

/* ---------- YOUR EXISTING ANIMATIONS ---------- */

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.animationPlayState = "running";
    }
  });
});
document.querySelectorAll(".card").forEach(card => observer.observe(card));

/* ---------- AUTO LOAD ---------- */
loadUser();