const historyRoot = document.getElementById("historyList");
const historyChart = document.getElementById("historyDurationChart");
const historyDataNotice = document.getElementById("historyDataNotice");
const historyKey = "trekmate-view-history";
const clearHistoryButton = document.getElementById("clearHistory");
let availableTreks = [];

function escapeHistoryText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function getHistory() {
    try {
        const saved = JSON.parse(localStorage.getItem(historyKey) || "[]");
        return Array.isArray(saved)
            ? saved.filter((item) => item && typeof item.id === "string" && typeof item.name === "string")
            : [];
    } catch (error) {
        console.warn("Could not read TrekMate history from this browser:", error);
        return [];
    }
}

function renderHistory() {
    const history = getHistory();
    clearHistoryButton.hidden = history.length === 0;
    renderTrekDurationChart(historyChart, history, availableTreks);

    if (!history.length) {
        historyRoot.innerHTML = `
            <div class="history-empty">
                <span aria-hidden="true">↗</span>
                <h3>No treks viewed yet.</h3>
                <p>Open a trek’s details and it will appear here for next time.</p>
                <a class="button button-primary" href="/#treks">Explore treks <span>→</span></a>
            </div>
        `;
        return;
    }

    historyRoot.innerHTML = history.map((item) => {
        const date = new Date(item.viewedAt);
        const viewedAt = Number.isNaN(date.getTime())
            ? "Previously viewed"
            : `Viewed ${date.toLocaleString()}`;
        return `
            <article class="history-card">
                <a class="history-image" href="/trek.html?id=${encodeURIComponent(item.id)}" style="background-image:url('${escapeHistoryText(item.image)}')" aria-label="View ${escapeHistoryText(item.name)} details"></a>
                <div class="history-card-info">
                    <p class="trek-location">${escapeHistoryText(item.location)}</p>
                    <h3>${escapeHistoryText(item.name)}</h3>
                    <p class="history-viewed-at">${escapeHistoryText(viewedAt)}</p>
                    <a class="trek-view-link" href="/trek.html?id=${encodeURIComponent(item.id)}">View details <span aria-hidden="true">↗</span></a>
                </div>
            </article>
        `;
    }).join("");
}

async function loadTrekDurations() {
    try {
        const response = await fetch("/api/treks");
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.treks)) {
            throw new Error(data.message || "Could not load trek durations.");
        }
        availableTreks = data.treks;
        historyDataNotice.textContent = "";
        renderHistory();
    } catch (error) {
        console.error("Could not load trek durations for history:", error);
        historyDataNotice.textContent = "Trek duration details could not be loaded. Revisit this page while connected to see the duration chart.";
    }
}

clearHistoryButton.addEventListener("click", () => {
    try {
        localStorage.removeItem(historyKey);
        historyDataNotice.textContent = "";
        renderHistory();
    } catch (error) {
        console.error("Could not clear TrekMate history:", error);
        historyRoot.textContent = "Could not clear history. Check your browser storage settings and try again.";
    }
});

renderHistory();
loadTrekDurations();
