function renderTrekDurationChart(container, history, treks = []) {
    if (!container) {
        return;
    }

    const treksById = new Map(treks.map((trek) => [trek.id, trek]));
    const chartItems = history.map((item) => {
        const trek = treksById.get(item.id);
        const duration = typeof item.duration === "string" ? item.duration : trek?.duration;
        const match = typeof duration === "string" ? duration.trim().match(/^(\d+)\s+days?$/i) : null;
        const days = match ? Number(match[1]) : 0;
        return {
            name: item.name || trek?.name || "Unnamed trek",
            days
        };
    }).filter((item) => Number.isSafeInteger(item.days) && item.days > 0);

    if (!chartItems.length) {
        container.hidden = true;
        container.replaceChildren();
        return;
    }

    const longestTrek = Math.max(...chartItems.map((item) => item.days));
    const escapeText = (value) => String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);

    container.hidden = false;
    container.innerHTML = `
        <section class="history-duration-panel" aria-labelledby="durationChartTitle">
            <div class="history-duration-heading">
                <div><p class="eyebrow">TRIP LENGTH</p><h3 id="durationChartTitle">Days per trek</h3></div>
                <span class="history-duration-unit">DAYS</span>
            </div>
            <div class="history-duration-rows" role="list">
                ${chartItems.map((item) => `
                    <div class="history-duration-row" role="listitem">
                        <span class="history-duration-name">${escapeText(item.name)}</span>
                        <div class="history-duration-track" aria-hidden="true"><span style="width:${(item.days / longestTrek) * 100}%"></span></div>
                        <strong class="history-duration-value">${item.days} ${item.days === 1 ? "day" : "days"}</strong>
                    </div>
                `).join("")}
            </div>
        </section>
    `;
}
