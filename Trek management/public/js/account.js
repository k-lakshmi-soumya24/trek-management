const signInForm = document.getElementById("signInForm");
const registerForm = document.getElementById("registerForm");
const authForms = document.getElementById("authForms");
const accountWelcome = document.getElementById("accountWelcome");

function showAuthTab(tab) {
    const isSignIn = tab === "signin";
    signInForm.hidden = !isSignIn;
    registerForm.hidden = isSignIn;
    document.getElementById("signInTab").classList.toggle("is-active", isSignIn);
    document.getElementById("registerTab").classList.toggle("is-active", !isSignIn);
    document.getElementById("signInTab").setAttribute("aria-selected", String(isSignIn));
    document.getElementById("registerTab").setAttribute("aria-selected", String(!isSignIn));
    document.getElementById("accountTitle").textContent = isSignIn ? "Sign in to TrekMate" : "Create your account";
    document.getElementById("accountDescription").textContent = isSignIn
        ? "Pick up where your next adventure begins."
        : "Join TrekMate and start planning your next adventure.";
}

function setFormError(id, message) {
    document.getElementById(id).textContent = message;
}

async function sendAuthRequest(url, form) {
    const submitButton = form.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "Please wait…";

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "We could not complete that request.");
        }
        if (data.user.role === "admin") {
            window.location.assign("/admin.html");
            return;
        }
        showSignedIn(data.user);
    } catch (error) {
        console.error("Account request failed:", error);
        const errorId = form === signInForm ? "signInError" : "registerError";
        setFormError(errorId, error instanceof Error ? error.message : "Unable to reach TrekMate.");
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
    }
}

function showSignedIn(user) {
    authForms.hidden = true;
    accountWelcome.hidden = false;
    document.getElementById("welcomeName").textContent = user.name;
}

document.getElementById("signInTab").addEventListener("click", () => showAuthTab("signin"));
document.getElementById("registerTab").addEventListener("click", () => showAuthTab("register"));

signInForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setFormError("signInError", "");
    sendAuthRequest("/api/auth/login", signInForm);
});

registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setFormError("registerError", "");
    sendAuthRequest("/api/auth/register", registerForm);
});

document.getElementById("signOutButton").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    accountWelcome.hidden = true;
    authForms.hidden = false;
});

document.addEventListener("DOMContentLoaded", async () => {
    try {
        const response = await fetch("/api/auth/me");
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Could not check your account.");
        }
        if (data.user?.role === "admin") {
            window.location.assign("/admin.html");
            return;
        }
        if (data.user) {
            showSignedIn(data.user);
        }
    } catch (error) {
        console.error("Could not check account session:", error);
        setFormError("signInError", "Could not connect to the account service. Refresh and try again.");
    }
});
