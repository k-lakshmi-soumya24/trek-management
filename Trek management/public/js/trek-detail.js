const detailRoot = document.getElementById("trekDetail");
const trekId = new URLSearchParams(window.location.search).get("id");

function safeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function rupees(value) {
    return `₹${Number(value).toLocaleString("en-IN")}`;
}

function renderList(items) {
    return `<ul>${items.map((item) => `<li>${safeText(item)}</li>`).join("")}</ul>`;
}

function rememberTrek(trek) {
    const historyKey = "trekmate-view-history";
    try {
        const savedHistory = JSON.parse(localStorage.getItem(historyKey) || "[]");
        const history = Array.isArray(savedHistory) ? savedHistory : [];
        const nextHistory = history.filter((item) => item.id !== trek.id);
        nextHistory.unshift({
            id: trek.id,
            name: trek.name,
            location: trek.location,
            image: trek.image,
            duration: trek.duration,
            viewedAt: new Date().toISOString()
        });
        localStorage.setItem(historyKey, JSON.stringify(nextHistory.slice(0, 25)));
    } catch (error) {
        console.warn("Could not save trek browsing history in this browser:", error);
    }
}

function renderTrek(trek) {
    const estimatedLow = trek.budget.reduce((total, item) => total + item.low, 0);
    const estimatedHigh = trek.budget.reduce((total, item) => total + item.high, 0);
    document.title = `${trek.name} | TrekMate trek details`;
    rememberTrek(trek);

    detailRoot.innerHTML = `
        <section class="detail-hero" style="--trek-cover: url('${safeText(trek.image)}')">
            <div class="detail-hero-shade"></div>
            <div class="detail-hero-content">
                <a class="detail-back detail-back-light" href="/#treks">← All treks</a>
                <p class="eyebrow light-eyebrow">${safeText(trek.tag)} · ${safeText(trek.location)}</p>
                <h1>${safeText(trek.name)}</h1>
                <p class="detail-summary">${safeText(trek.overview)}</p>
                <p class="trek-visitor-count" id="trekVisitorCount" role="status" aria-live="polite">Counting visitors…</p>
                <div class="detail-stats">
                    <span><small>DIFFICULTY</small><strong>${safeText(trek.difficulty)}</strong></span>
                    <span><small>DISTANCE</small><strong>${safeText(trek.distance)}</strong></span>
                    <span><small>TRIP LENGTH</small><strong>${safeText(trek.duration)}</strong></span>
                    <span><small>TIME TO FINISH</small><strong>${safeText(trek.hikingTime)}</strong></span>
                    <span><small>BEST TIME</small><strong>${safeText(trek.bestTime)}</strong></span>
                </div>
                <a class="button button-primary detail-book-button" href="/?book=${encodeURIComponent(trek.id)}#treks">Request this trek <span>↗</span></a>
            </div>
        </section>

        <div class="detail-content">
            <section class="detail-main-column">
                <section class="detail-section">
                    <p class="eyebrow">YOUR TRAIL, DAY BY DAY</p>
                    <h2>What the trek <em>looks like.</em></h2>
                    <div class="itinerary-list">
                        ${trek.itinerary.map((step, index) => `
                            <article class="itinerary-step">
                                <span class="itinerary-index">${String(index + 1).padStart(2, "0")}</span>
                                <div><p class="itinerary-day">${safeText(step.day)}</p><h3>${safeText(step.title)}</h3><p>${safeText(step.description)}</p></div>
                            </article>
                        `).join("")}
                    </div>
                </section>
                <section class="detail-section">
                    <p class="eyebrow">GUIDE AND SAFETY</p>
                    <h2>Go prepared. <em>Come back smiling.</em></h2>
                    <article class="guide-card">
                        <span class="guide-icon" aria-hidden="true">✳</span>
                        <div><h3>Local guide availability</h3><p>${safeText(trek.guideAvailability)}</p></div>
                    </article>
                    <div class="safety-card">
                        <h3>Safety measures</h3>
                        ${renderList(trek.safety)}
                        <p class="safety-disclaimer">These are general reminders, not a substitute for current local guidance. Check official alerts and follow your guide’s instructions.</p>
                    </div>
                </section>
                <section class="detail-section">
                    <p class="eyebrow">KNOW BEFORE YOU GO</p>
                    <h2>Included <em>and not.</em></h2>
                    <div class="inclusion-grid">
                        <div class="inclusion-card"><h3>Typically included</h3>${renderList(trek.included)}</div>
                        <div class="inclusion-card"><h3>Plan separately</h3>${renderList(trek.notIncluded)}</div>
                    </div>
                </section>
            </section>

            <aside class="budget-card">
                <p class="eyebrow">PLAN YOUR SPEND</p>
                <h2>Trip budget <em>estimate.</em></h2>
                <p class="budget-per-person">Estimated per person · INR</p>
                <div class="budget-lines">
                    ${trek.budget.map((item) => `
                        <div class="budget-line"><span>${safeText(item.item)}</span><strong>${item.low === item.high ? rupees(item.low) : `${rupees(item.low)}–${rupees(item.high)}`}</strong></div>
                    `).join("")}
                </div>
                <div class="budget-total"><span>Estimated trip total</span><strong>${rupees(estimatedLow)}–${rupees(estimatedHigh)}</strong></div>
                <p class="budget-note">Estimate for planning only. Transport, accommodation, meals, local permits, and inclusions vary by operator, date, and group size. Confirm the final quote before paying.</p>
                <a class="button button-primary budget-cta" href="/?book=${encodeURIComponent(trek.id)}#treks">Ask about this trek <span>→</span></a>
            </aside>
        </div>
    `;
    recordTrekVisit(trek.id, document.getElementById("trekVisitorCount"));
}

async function loadTrek() {
    if (!trekId) {
        detailRoot.innerHTML = '<section class="detail-error"><h1>Choose a trail to explore.</h1><p>Go back to the trek list and select a trek to view its itinerary and budget.</p><a class="button button-primary" href="/#treks">Browse treks <span>→</span></a></section>';
        return;
    }

    try {
        const response = await fetch(`/api/treks/${encodeURIComponent(trekId)}`);
        const data = await response.json();
        if (!response.ok || !data.success || !data.trek) {
            throw new Error(data.message || "Could not load this trek.");
        }
        renderTrek(data.trek);
    } catch (error) {
        console.error("Could not load trek details:", error);
        detailRoot.innerHTML = `<section class="detail-error"><h1>Trek details are unavailable.</h1><p>${safeText(error instanceof Error ? error.message : "Please try again.")}</p><a class="button button-primary" href="/#treks">Back to treks <span>→</span></a></section>`;
    }
}

loadTrek();
