const trekVisitorIdKey = "trekmate-anonymous-visitor-id";

function getTrekVisitorId() {
    try {
        let visitorId = localStorage.getItem(trekVisitorIdKey);
        if (!visitorId) {
            visitorId = crypto.randomUUID();
            localStorage.setItem(trekVisitorIdKey, visitorId);
        }
        return visitorId;
    } catch (error) {
        console.warn("Could not access anonymous visitor storage:", error);
        return null;
    }
}

async function recordTrekVisit(trekId, countElement) {
    const visitorId = getTrekVisitorId();
    if (!visitorId) {
        countElement.textContent = "Visitor count unavailable in this browser.";
        return;
    }

    try {
        const response = await fetch(`/api/treks/${encodeURIComponent(trekId)}/views`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ visitorId })
        });
        const data = await response.json();
        if (!response.ok || !data.success || !Number.isSafeInteger(data.uniqueVisitors) || data.uniqueVisitors < 0) {
            throw new Error(data.message || "Could not load the visitor count.");
        }
        countElement.textContent = `Opened by ${data.uniqueVisitors.toLocaleString()} unique ${data.uniqueVisitors === 1 ? "browser" : "browsers"}`;
    } catch (error) {
        console.error("Could not record or load the trek visitor count:", error);
        countElement.textContent = "Visitor count unavailable right now.";
    }
}
