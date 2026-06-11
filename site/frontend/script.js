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

function showTopNotification(message, type = "success") {
  if (!message) return;

  let stack = document.getElementById("rbToastStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "rbToastStack";
    stack.className = "rb-toast-stack";
    document.body.appendChild(stack);
  }

  const toast = document.createElement("div");
  toast.className = `rb-toast ${type === "error" ? "error" : "success"}`;
  toast.textContent = message;
  stack.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.remove();
      if (!stack.childElementCount) {
        stack.remove();
      }
    }, 260);
  }, 2200);
}

function showSuccessNotification(message) {
  showTopNotification(message, "success");
}

async function signup() {
  const username = document.getElementById("user")?.value || "";
  const password = document.getElementById("pass")?.value || "";

  // New fields (optional, won't break old behavior)
  const email = document.getElementById("email")?.value || "";
  const firstName = document.getElementById("firstName")?.value || "";
  const lastName = document.getElementById("lastName")?.value || "";
  const university = document.getElementById("university")?.value || "";
  const course = document.getElementById("course")?.value || "";

  if (!username || !password) {
    alert("Username and password are required");
    return;
  }

  try {
    const res = await fetch(API + "/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        email,
        firstName,
        lastName,
        university,
        course
      })
    });

    const data = await res.json();
    if (data.error) {
      alert(data.error);
    } else {
      showTopNotification("Account created successfully");
      setTimeout(() => {
        window.location.href = "signin.html";
      }, 2000);
    }
  } catch (error) {
    alert("Error: Server not running or connection failed");
  }
}

function login() {
  const username = document.getElementById("loginUser").value;
  const password = document.getElementById("loginPass").value;

  if (!username || !password) {
    alert("Username and password are required");
    return;
  }

  try {
    fetch(API + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        localStorage.setItem("rolebit_user", data.username);  // MATCH HOME PAGE
        if (data?.profile?.profilePhoto) {
          localStorage.setItem("rolebit_profile_photo", data.profile.profilePhoto);
        } else {
          localStorage.removeItem("rolebit_profile_photo");
        }

        if (data.isAdmin === true) {
          localStorage.setItem("rolebit_admin", "true");
          showTopNotification("Signed in");
          window.location.href = "dashboard.html";
        } else {
          localStorage.removeItem("rolebit_admin");
          showTopNotification("Signed in");
          window.location.href = "coming-soon.html";
        }
      } else {
        alert("Invalid login");
      }
    })
    .catch(() => alert("Server not running"));
  } catch (error) {
    alert("Connection error");
  }
}


function loadUser() {
  const u = localStorage.getItem("rolebit_user");

  if (u) {
    const w = document.getElementById("welcome");
    const d = document.getElementById("homeDashboardBtn");
    const l = document.getElementById("logoutBtn");
    if (w) {
      w.innerText = "Welcome, " + u;
      w.classList.add("active");
    }
    if (d) d.style.display = "inline-flex";
    if (l) l.style.display = "inline-flex";
  }

  const protectedPages = ["dashboard", "projects", "circle", "profile", "calendar", "timeline", "github"];
  const isProtected = protectedPages.some(p => location.pathname.includes(p));

  if (!u && isProtected) {
    window.location.href = "signin.html";
  }
}

function renderSidebarProfileShortcut() {
  const user = String(localStorage.getItem("rolebit_user") || "").trim();
  if (!user) return;

  const photo = String(localStorage.getItem("rolebit_profile_photo") || "").trim();
  const initials = user.slice(0, 1).toUpperCase();

  document.querySelectorAll(".signin-logo").forEach((container) => {
    container.innerHTML = `
      <a href="profile.html" title="Profile" aria-label="Open profile">
        ${photo ? `<img src="${photo}" alt="Profile Photo" class="sidebar-profile-avatar">` : `<span class="sidebar-profile-fallback">${initials}</span>`}
      </a>
    `;
  });
}

function logout() {
  localStorage.removeItem("rolebit_user");
  localStorage.removeItem("rolebit_admin");
  window.location.href = "signin.html";
}

function goDashboard() {
  window.location.href = "dashboard.html";
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

/* ---------- AUTO LOAD ---------- */
loadUser();
wireAuthButtons();
renderSidebarProfileShortcut();
