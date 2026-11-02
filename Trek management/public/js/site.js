const trekGrid = document.getElementById("trekGrid");
const trekSearch = document.getElementById("trekSearch");
const difficultyFilter = document.getElementById("difficultyFilter");
const bookingDialog = document.getElementById("bookingDialog");
const bookingForm = document.getElementById("bookingForm");
const bookingTrek = document.getElementById("bookingTrek");

let treks = [];
let trekMap = null;
let trekMapMarkers = [];
let trekMapRoute = null;
let routeRequestNumber = 0;
const trekHistoryKey = "trekmate-view-history";

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function setApiStatus(connected, message) {
    const status = document.querySelector(".live-status");
    status.classList.toggle("connected", connected);
    status.classList.toggle("disconnected", !connected);
    document.getElementById("apiStatusText").textContent = message;
}

function setAiAvailability(ready, message) {
    const status = document.getElementById("aiAvailability");
    const setupLink = document.getElementById("aiSetupLink");

    status.classList.toggle("is-ready", ready);
    status.classList.toggle("is-unavailable", !ready);
    document.getElementById("aiAvailabilityText").textContent = message;
    setupLink.hidden = ready;
}

async function loadTreks() {
    trekGrid.innerHTML = '<div class="loading-card"><span class="loading-spinner"></span> Finding your next trail…</div>';

    try {
        const response = await fetch("/api/treks");
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.treks)) {
            throw new Error(data.message || "Could not load treks.");
        }

        treks = data.treks;
        populateTrekOptions();
        renderTreks();
        populateRouteSelectors();
        renderTrekHistory();
        updateTrekMap();
        setApiStatus(true, "Trails are up to date");
        const requestedTrek = new URLSearchParams(window.location.search).get("book");
        if (requestedTrek && treks.some((trek) => trek.id === requestedTrek)) {
            openBooking(requestedTrek);
            window.history.replaceState({}, "", "/#treks");
        }
    } catch (error) {
        console.error("Could not load treks:", error);
        trekGrid.innerHTML = '<div class="empty-card">We could not load the trails right now. <button type="button" id="retryTreks">Try again</button></div>';
        document.getElementById("retryTreks").addEventListener("click", loadTreks);
        setApiStatus(false, "Connection unavailable");
    }
}

async function checkApiStatus() {
    try {
        const response = await fetch("/api/status");
        if (!response.ok) {
            throw new Error("Backend status check failed.");
        }
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || "Backend status check failed.");
        }
        setApiStatus(true, "TrekMate is online");
        setAiAvailability(
            data.aiConfigured === true,
            data.aiConfigured === true
                ? "AI is ready. Ask TrekMate a question."
                : data.aiConfigurationMessage || "AI needs a valid OPENAI_API_KEY in the project .env file. Add it, then restart the server."
        );
    } catch (error) {
        console.error("Backend status check failed:", error);
        setApiStatus(false, "Connection unavailable");
        setAiAvailability(false, "Could not reach the backend. Start or restart the server, then refresh this page.");
    }
}

async function updateAccountNavigation() {
    const link = document.getElementById("accountNavLink");
    if (!link) {
        return;
    }
    try {
        const response = await fetch("/api/auth/me");
        const data = await response.json();
        if (response.ok && data.success && data.user) {
            link.textContent = data.user.role === "admin" ? "Admin dashboard" : `Hi, ${data.user.name}`;
            link.href = data.user.role === "admin" ? "/admin.html" : "/account.html";
        }
    } catch (error) {
        console.error("Could not load signed-in account:", error);
    }
}

function populateTrekOptions() {
    const selectedId = bookingTrek.value;
    bookingTrek.innerHTML = '<option value="">Choose a trek</option>' + treks
        .map((trek) => `<option value="${escapeHtml(trek.id)}">${escapeHtml(trek.name)} — ${escapeHtml(trek.location)}</option>`)
        .join("");
    if (treks.some((trek) => trek.id === selectedId)) {
        bookingTrek.value = selectedId;
    }
}

function renderTreks() {
    const searchTerm = trekSearch.value.trim().toLowerCase();
    const difficulty = difficultyFilter.value;
    const visibleTreks = treks.filter((trek) => {
        const matchesSearch = `${trek.name} ${trek.location} ${trek.description}`.toLowerCase().includes(searchTerm);
        return matchesSearch && (difficulty === "all" || trek.difficulty === difficulty);
    });

    document.getElementById("resultsCount").textContent =
        `${visibleTreks.length} ${visibleTreks.length === 1 ? "trail" : "trails"}`;

    if (!visibleTreks.length) {
        trekGrid.innerHTML = '<div class="empty-card">No trails match that search. Try another place or difficulty.</div>';
        return;
    }

    trekGrid.innerHTML = visibleTreks.map((trek) => `
        <article class="trek-card">
            <div class="trek-image" style="background-image: url('${escapeHtml(trek.image)}')">
                <span class="trek-tag">${escapeHtml(trek.tag)}</span>
                <span class="trek-level">${escapeHtml(trek.difficulty)}</span>
            </div>
            <div class="trek-info">
                <p class="trek-location">${escapeHtml(trek.location)}</p>
                <h3>${escapeHtml(trek.name)}</h3>
                <p class="trek-description">${escapeHtml(trek.description)}</p>
                <div class="trek-details"><span>${escapeHtml(trek.duration)}</span><span>${escapeHtml(trek.distance)}</span></div>
                <div class="trek-bottom">
                    <span class="trek-price"><small>STARTING FROM / PERSON</small><strong>₹${Number(trek.price).toLocaleString("en-IN")}</strong></span>
                    <button class="trek-view-link" type="button" data-view-trek="${escapeHtml(trek.id)}">View all details <span aria-hidden="true">↗</span></button>
                </div>
            </div>
        </article>
    `).join("");

    trekGrid.querySelectorAll("[data-view-trek]").forEach((button) => {
        button.addEventListener("click", () => openTrekDetails(button.dataset.viewTrek));
    });

}

function rememberViewedTrek(trek) {
    try {
        const existing = JSON.parse(localStorage.getItem(trekHistoryKey) || "[]");
        const history = Array.isArray(existing) ? existing : [];
        const viewed = history.filter((item) => item.id !== trek.id);
        viewed.unshift({
            id: trek.id,
            name: trek.name,
            location: trek.location,
            image: trek.image,
            duration: trek.duration,
            viewedAt: new Date().toISOString()
        });
        localStorage.setItem(trekHistoryKey, JSON.stringify(viewed.slice(0, 25)));
        renderTrekHistory();
    } catch (error) {
        console.warn("Could not save trek history in this browser:", error);
    }
}

function renderTrekHistory() {
    const historyRoot = document.getElementById("historyList");
    if (!historyRoot) {
        return;
    }
    let history = [];
    try {
        const saved = JSON.parse(localStorage.getItem(trekHistoryKey) || "[]");
        history = Array.isArray(saved) ? saved.filter((item) => item && typeof item.id === "string") : [];
    } catch (error) {
        console.warn("Could not read trek history:", error);
    }

    const clearButton = document.getElementById("clearHistory");
    clearButton.hidden = history.length === 0;
    renderTrekDurationChart(document.getElementById("historyDurationChart"), history, treks);
    if (!history.length) {
        historyRoot.innerHTML = '<div class="history-empty"><span aria-hidden="true">↗</span><h3>No treks viewed yet.</h3><p>Choose “View all details” on any trek and it will show up here.</p><a class="button button-primary" href="#treks">Explore treks <span>→</span></a></div>';
        return;
    }

    historyRoot.innerHTML = history.map((item) => {
        const viewedAt = new Date(item.viewedAt);
        const dateLabel = Number.isNaN(viewedAt.getTime()) ? "Recently viewed" : `Viewed ${viewedAt.toLocaleString()}`;
        return `<article class="history-card">
            <button class="history-image" type="button" data-view-trek="${escapeHtml(item.id)}" style="background-image:url('${escapeHtml(item.image)}')" aria-label="View ${escapeHtml(item.name)} details"></button>
            <div class="history-card-info">
                <p class="trek-location">${escapeHtml(item.location)}</p><h3>${escapeHtml(item.name)}</h3>
                <p class="history-viewed-at">${escapeHtml(dateLabel)}</p>
                <button class="trek-view-link" type="button" data-view-trek="${escapeHtml(item.id)}">Open details <span aria-hidden="true">↗</span></button>
            </div>
        </article>`;
    }).join("");

    historyRoot.querySelectorAll("[data-view-trek]").forEach((button) => {
        button.addEventListener("click", () => openTrekDetails(button.dataset.viewTrek));
    });
}

function formatRupees(value) {
    return `₹${Number(value).toLocaleString("en-IN")}`;
}

async function openTrekDetails(trekId) {
    const dialog = document.getElementById("trekDetailDialog");
    const content = document.getElementById("trekDetailContent");
    content.innerHTML = '<div class="detail-loading"><span class="loading-spinner"></span> Loading trek details…</div>';
    dialog.showModal();

    try {
        const response = await fetch(`/api/treks/${encodeURIComponent(trekId)}`);
        const data = await response.json();
        if (!response.ok || !data.success || !data.trek) {
            throw new Error(data.message || "Could not load this trek.");
        }
        const trek = data.trek;
        rememberViewedTrek(trek);
        const totalLow = trek.budget.reduce((total, item) => total + item.low, 0);
        const totalHigh = trek.budget.reduce((total, item) => total + item.high, 0);
        content.innerHTML = `
            <section class="inline-detail-hero" style="--trek-cover:url('${escapeHtml(trek.image)}')">
                <p class="eyebrow light-eyebrow">${escapeHtml(trek.tag)} · ${escapeHtml(trek.location)}</p>
                <h2 id="inlineTrekTitle">${escapeHtml(trek.name)}</h2>
                <p>${escapeHtml(trek.overview)}</p>
                <p class="trek-visitor-count" id="trekVisitorCount" role="status" aria-live="polite">Counting visitors…</p>
                <div class="detail-stats">
                    <span><small>DIFFICULTY</small><strong>${escapeHtml(trek.difficulty)}</strong></span>
                    <span><small>TREK DISTANCE</small><strong>${escapeHtml(trek.distance)}</strong></span>
                    <span><small>TRIP LENGTH</small><strong>${escapeHtml(trek.duration)}</strong></span>
                    <span><small>TIME TO FINISH</small><strong>${escapeHtml(trek.hikingTime)}</strong></span>
                    <span><small>BEST TIME</small><strong>${escapeHtml(trek.bestTime)}</strong></span>
                </div>
            </section>
            <div class="inline-detail-body">
                <div class="inline-detail-main">
                    <section class="detail-section"><p class="eyebrow">YOUR TRAIL, DAY BY DAY</p><h3>Itinerary</h3>
                        <div class="itinerary-list">${trek.itinerary.map((step, index) => `<article class="itinerary-step"><span class="itinerary-index">${String(index + 1).padStart(2, "0")}</span><div><p class="itinerary-day">${escapeHtml(step.day)}</p><h4>${escapeHtml(step.title)}</h4><p>${escapeHtml(step.description)}</p></div></article>`).join("")}</div>
                    </section>
                    <section class="detail-section"><p class="eyebrow">GUIDE AND SAFETY</p><h3>Be prepared for the trail</h3>
                        <article class="guide-card"><span class="guide-icon" aria-hidden="true">✳</span><div><h4>Guide availability</h4><p>${escapeHtml(trek.guideAvailability)}</p></div></article>
                        <div class="safety-card"><h4>Safety measures</h4><ul>${trek.safety.map((tip) => `<li>${escapeHtml(tip)}</li>`).join("")}</ul><p class="safety-disclaimer">General planning guidance only. Check current official alerts and follow your local guide’s instructions.</p></div>
                    </section>
                    <section class="detail-section"><p class="eyebrow">KNOW BEFORE YOU GO</p><h3>What to budget for</h3>
                        <div class="budget-lines">${trek.budget.map((item) => `<div class="budget-line"><span>${escapeHtml(item.item)}</span><strong>${item.low === item.high ? formatRupees(item.low) : `${formatRupees(item.low)}–${formatRupees(item.high)}`}</strong></div>`).join("")}</div>
                        <div class="budget-total"><span>Estimated total per person</span><strong>${formatRupees(totalLow)}–${formatRupees(totalHigh)}</strong></div>
                        <div class="inclusion-grid"><div class="inclusion-card"><h4>Typically included</h4><ul>${trek.included.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div><div class="inclusion-card"><h4>Plan separately</h4><ul>${trek.notIncluded.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></div>
                    </section>
                </div>
                <aside class="inline-detail-aside"><p class="eyebrow">COMPARE LOCATIONS</p><p>See travel distance to this trek from another trek base on the map.</p><button class="button button-outline" type="button" data-map-trek="${escapeHtml(trek.id)}">Compare on map ↓</button>
                <p class="budget-note">Budget, access, guide availability, and timings are estimates. Confirm details with the local operator.</p>
                <button class="button button-primary inline-book-button" type="button" data-book-trek="${escapeHtml(trek.id)}">Request this trek <span>↗</span></button></aside>
            </div>`;

        recordTrekVisit(trek.id, content.querySelector("#trekVisitorCount"));
        content.querySelector("[data-book-trek]").addEventListener("click", () => {
            dialog.close();
            openBooking(trek.id);
        });
        content.querySelector("[data-map-trek]").addEventListener("click", (event) => {
            const selectedTrekId = event.currentTarget.dataset.mapTrek;
            document.getElementById("routeTo").value = selectedTrekId;
            if (document.getElementById("routeFrom").value === selectedTrekId) {
                document.getElementById("routeFrom").value = treks.find((item) => item.id !== selectedTrekId)?.id || "";
            }
            dialog.close();
            document.getElementById("route-map").scrollIntoView({ behavior: "smooth" });
            updateTrekMap();
        });
    } catch (error) {
        console.error("Could not load trek details:", error);
        content.innerHTML = `<div class="detail-error"><h2>Could not load trek details.</h2><p>${escapeHtml(error instanceof Error ? error.message : "Please try again.")}</p></div>`;
    }
}

function populateRouteSelectors() {
    const from = document.getElementById("routeFrom");
    const to = document.getElementById("routeTo");
    const optionMarkup = treks.map((trek) =>
        `<option value="${escapeHtml(trek.id)}">${escapeHtml(trek.name)} · ${escapeHtml(trek.location)}</option>`
    ).join("");
    from.innerHTML = optionMarkup;
    to.innerHTML = optionMarkup;
    if (treks.length > 1) {
        from.value = treks[0].id;
        to.value = treks[1].id;
    }
}

function getTrekById(id) {
    return treks.find((trek) => trek.id === id);
}

function straightLineDistance(first, second) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const latDelta = radians(second.coordinates.lat - first.coordinates.lat);
    const lngDelta = radians(second.coordinates.lng - first.coordinates.lng);
    const firstLat = radians(first.coordinates.lat);
    const secondLat = radians(second.coordinates.lat);
    const a = Math.sin(latDelta / 2) ** 2
        + Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(lngDelta / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function initializeTrekMap() {
    const mapElement = document.getElementById("trekMap");
    const summary = document.getElementById("routeSummary");
    if (!window.L) {
        summary.textContent = "The interactive map could not load. Check your internet connection and refresh to load OpenStreetMap.";
        mapElement.innerHTML = '<p class="map-fallback">Map tiles need an internet connection. The location and distance comparison controls are available above.</p>';
        return false;
    }
    if (trekMap) {
        return true;
    }

    trekMap = window.L.map(mapElement).setView([22.5, 79], 4.5);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
    }).addTo(trekMap);
    return true;
}

async function updateTrekMap() {
    if (!treks.length || !initializeTrekMap()) {
        return;
    }
    const from = getTrekById(document.getElementById("routeFrom").value);
    const to = getTrekById(document.getElementById("routeTo").value);
    if (!from || !to) {
        return;
    }

    routeRequestNumber += 1;
    const requestNumber = routeRequestNumber;
    const summary = document.getElementById("routeSummary");
    const firstPoint = [from.coordinates.lat, from.coordinates.lng];
    const secondPoint = [to.coordinates.lat, to.coordinates.lng];

    trekMapMarkers.forEach((marker) => marker.remove());
    trekMapMarkers = [from, to].map((trek, index) =>
        window.L.marker(index === 0 ? firstPoint : secondPoint)
            .addTo(trekMap)
            .bindPopup(`<strong>${escapeHtml(trek.name)}</strong><br>${escapeHtml(trek.location)}`)
    );
    if (trekMapRoute) {
        trekMapRoute.remove();
        trekMapRoute = null;
    }

    summary.textContent = `Calculating route from ${from.name} to ${to.name}…`;
    let coordinates = [firstPoint, secondPoint];
    let distanceText = `${Math.round(straightLineDistance(from, to))} km straight-line`;
    let durationText = "Driving time unavailable";
    let estimateType = "Direct distance only; this is not a road route.";

    try {
        const routeUrl = `https://router.project-osrm.org/route/v1/driving/${from.coordinates.lng},${from.coordinates.lat};${to.coordinates.lng},${to.coordinates.lat}?overview=full&geometries=geojson`;
        const response = await fetch(routeUrl);
        const data = await response.json();
        if (!response.ok || data.code !== "Ok" || !data.routes?.[0]) {
            throw new Error(data.message || "No driving route returned.");
        }
        const route = data.routes[0];
        coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        distanceText = `${(route.distance / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km by road`;
        const minutes = Math.round(route.duration / 60);
        durationText = minutes >= 60
            ? `about ${Math.floor(minutes / 60)} hr ${minutes % 60} min`
            : `about ${minutes} min`;
        estimateType = "Road route estimate; traffic, road closures, and actual travel time can vary.";
    } catch (error) {
        console.warn("Driving route unavailable; showing straight-line estimate:", error);
    }

    if (requestNumber !== routeRequestNumber) {
        return;
    }
    trekMapRoute = window.L.polyline(coordinates, {
        color: "#47744a",
        weight: 5,
        opacity: 0.85,
        dashArray: distanceText.includes("straight-line") ? "8 8" : null
    }).addTo(trekMap);
    trekMap.fitBounds(trekMapRoute.getBounds().pad(0.18), { maxZoom: 8 });
    summary.textContent = `${from.name} → ${to.name}: ${distanceText}; estimated travel ${durationText}. ${estimateType}`;
}

function openBooking(trekId = "") {
    document.getElementById("bookingError").textContent = "";
    document.getElementById("bookingForm").hidden = false;
    document.getElementById("bookingSuccess").hidden = true;
    bookingForm.reset();
    bookingTrek.value = trekId;
    bookingDialog.showModal();
}

function setDateMinimum() {
    const date = new Date();
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10);
    document.getElementById("bookingDate").min = localDate;
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("currentYear").textContent = new Date().getFullYear();
    setDateMinimum();
    loadTreks();
    checkApiStatus();
    updateAccountNavigation();
    if (window.L) {
        window.L.Icon.Default.imagePath = "https://unpkg.com/leaflet@1.9.4/dist/images/";
    }

    trekSearch.addEventListener("input", renderTreks);
    difficultyFilter.addEventListener("change", renderTreks);

    document.querySelectorAll("[data-open-booking]").forEach((button) => {
        button.addEventListener("click", () => openBooking());
    });

    document.getElementById("closeBooking").addEventListener("click", () => bookingDialog.close());
    document.getElementById("doneBooking").addEventListener("click", () => bookingDialog.close());
    document.getElementById("clearHistory").addEventListener("click", () => {
        try {
            localStorage.removeItem(trekHistoryKey);
            renderTrekHistory();
        } catch (error) {
            console.error("Could not clear trek history:", error);
        }
    });
    document.getElementById("routeFrom").addEventListener("change", updateTrekMap);
    document.getElementById("routeTo").addEventListener("change", updateTrekMap);
    document.getElementById("closeTrekDetails").addEventListener("click", () => {
        document.getElementById("trekDetailDialog").close();
    });
    document.getElementById("trekDetailDialog").addEventListener("click", (event) => {
        if (event.target === event.currentTarget) {
            event.currentTarget.close();
        }
    });

    bookingDialog.addEventListener("click", (event) => {
        if (event.target === bookingDialog) {
            bookingDialog.close();
        }
    });

    bookingDialog.addEventListener("close", () => {
        bookingForm.reset();
        document.getElementById("bookingError").textContent = "";
    });

    document.getElementById("menuToggle").addEventListener("click", (event) => {
        const menu = document.getElementById("siteNav");
        const isOpen = menu.classList.toggle("is-open");
        event.currentTarget.setAttribute("aria-expanded", String(isOpen));
        event.currentTarget.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
    });

    document.querySelectorAll("#siteNav a").forEach((link) => {
        link.addEventListener("click", () => {
            document.getElementById("siteNav").classList.remove("is-open");
            document.getElementById("menuToggle").setAttribute("aria-expanded", "false");
        });
    });

    document.getElementById("aiForm").addEventListener("submit", (event) => {
        event.preventDefault();
        askAI();
    });

    bookingForm.addEventListener("submit", submitBooking);
});

async function submitBooking(event) {
    event.preventDefault();

    const submitButton = document.getElementById("bookingSubmit");
    const errorElement = document.getElementById("bookingError");
    const formData = new FormData(bookingForm);
    const request = Object.fromEntries(formData.entries());
    request.groupSize = Number(request.groupSize);

    errorElement.textContent = "";
    submitButton.disabled = true;
    submitButton.textContent = "Sending request…";

    try {
        const response = await fetch("/api/bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request)
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Your request could not be sent.");
        }

        document.getElementById("bookingForm").hidden = true;
        document.getElementById("bookingConfirmation").textContent =
            `Your trip request ${data.booking.reference} has been saved. The TrekMate team can follow up using the contact details you provided.`;
        document.getElementById("bookingSuccess").hidden = false;
    } catch (error) {
        console.error("Trip request failed:", error);
        errorElement.textContent = error instanceof Error
            ? error.message
            : "Unable to send your request. Please try again.";
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = 'Send trip request <span>→</span>';
    }
}
