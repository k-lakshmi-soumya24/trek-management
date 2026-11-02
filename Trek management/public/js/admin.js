const adminAuth = document.getElementById("adminAuth");
const adminDashboard = document.getElementById("adminDashboard");

function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
}

function showAdmin(user) {
    adminAuth.hidden = true;
    adminDashboard.hidden = false;
    document.getElementById("adminWelcome").textContent = `Signed in as ${user.name} (${user.email})`;
    loadBookings();
}

async function loadBookings() {
    const container = document.getElementById("adminBookings");
    const error = document.getElementById("bookingLoadError");
    error.textContent = "";
    container.replaceChildren(document.createTextNode("Loading trip requests…"));

    try {
        const response = await fetch("/api/admin/bookings");
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Could not load trip requests.");
        }
        if (!data.bookings.length) {
            container.replaceChildren(document.createTextNode("No trip requests have been received yet."));
            return;
        }

        const table = document.createElement("table");
        table.className = "booking-table";
        const heading = table.createTHead().insertRow();
        ["Record", "Reference", "Trek", "Name", "Email", "Phone", "Date", "Group", "Status"].forEach((label) => {
            const cell = document.createElement("th");
            cell.scope = "col";
            cell.textContent = label;
            heading.appendChild(cell);
        });
        const body = table.createTBody();
        [...data.bookings].reverse().forEach((booking) => {
            const row = body.insertRow();
            [
                booking.isDemo ? "DEMO SAMPLE" : "Customer request",
                booking.reference,
                booking.trekName,
                booking.name,
                booking.email,
                booking.phone,
                booking.travelDate,
                String(booking.groupSize),
                booking.status
            ].forEach((value) => {
                row.insertCell().textContent = value || "";
            });
        });
        container.replaceChildren(table);
    } catch (error) {
        console.error("Could not load trip requests:", error);
        container.replaceChildren(document.createTextNode("Unable to load trip requests."));
        document.getElementById("bookingLoadError").textContent =
            error instanceof Error ? error.message : "Unable to load trip requests.";
    }
}

document.getElementById("adminSetupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const error = document.getElementById("adminSetupError");
    error.textContent = "";
    submit.disabled = true;
    submit.textContent = "Creating admin…";

    try {
        const response = await fetch("/api/auth/admin/setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formValues(form))
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Could not set up admin account.");
        }
        showAdmin(data.user);
    } catch (requestError) {
        console.error("Admin setup failed:", requestError);
        error.textContent = requestError instanceof Error ? requestError.message : "Unable to set up admin.";
    } finally {
        submit.disabled = false;
        submit.innerHTML = 'Create private admin <span>→</span>';
    }
});

document.getElementById("adminSignOut").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
});

document.addEventListener("DOMContentLoaded", async () => {
    try {
        const response = await fetch("/api/auth/me");
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Could not check admin access.");
        }
        if (data.user?.role === "admin") {
            showAdmin(data.user);
            return;
        }
        document.getElementById("adminLoginError").textContent = data.user
            ? `You are signed in as a regular user (${data.user.email}). Sign out there before signing in as an admin.`
            : "";
        document.getElementById("adminSetupDetails").hidden = !data.adminSetupAvailable;
        const setupNotice = document.getElementById("adminSetupNotice");
        setupNotice.hidden = data.adminSetupAvailable === true;
        setupNotice.textContent = data.adminSetupAvailable
            ? ""
            : data.adminSetupMessage || "First-admin setup is unavailable. Configure ADMIN_SETUP_CODE in the project .env file and restart the server.";
    } catch (error) {
        console.error("Could not check admin session:", error);
        document.getElementById("adminLoginError").textContent =
            "Could not connect to TrekMate. Start the server and refresh.";
    }
});
