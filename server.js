const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const { promisify } = require("util");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();

const PORT = Number(process.env.PORT) || 3004;
const frontendDirectory = path.join(__dirname, "Trek management", "public");
const bookingFile = path.join(__dirname, "data", "bookings.jsonl");
const trekVisitorFile = path.join(__dirname, "data", "trek-visitors.json");
const usersFile = path.join(__dirname, "data", "users.json");
const scrypt = promisify(crypto.scrypt);
const passwordHashLength = 64;
const sessionCookieName = "trekmate_session";
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const authAttempts = new Map();
let usersWriteQueue = Promise.resolve();
let trekVisitorsWriteQueue = Promise.resolve();

if (!process.env.SESSION_SECRET) {
    console.warn("SESSION_SECRET is not configured; users will need to sign in again after a server restart.");
}

function safeStringEqual(first, second) {
    const firstBuffer = Buffer.from(String(first));
    const secondBuffer = Buffer.from(String(second));
    return firstBuffer.length === secondBuffer.length
        && crypto.timingSafeEqual(firstBuffer, secondBuffer);
}

function getAdminSetupCodeError() {
    const setupCode = process.env.ADMIN_SETUP_CODE?.trim();
    if (!setupCode || setupCode.length < 24 || /replace|example|your[_ -]?code/i.test(setupCode)) {
        return "Admin setup is disabled. Add a private ADMIN_SETUP_CODE of at least 24 characters to .env, then restart the server.";
    }
    return null;
}

async function readUsers() {
    try {
        const content = (await fs.readFile(usersFile, "utf8")).replace(/^\uFEFF/, "");
        const users = JSON.parse(content);
        if (!Array.isArray(users)) {
            throw new Error("User data file must contain a JSON array.");
        }
        return users;
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}

function withUsersLock(operation) {
    const result = usersWriteQueue.then(operation);
    usersWriteQueue = result.catch(() => {});
    return result;
}

function withTrekVisitorsLock(operation) {
    const result = trekVisitorsWriteQueue.then(operation);
    trekVisitorsWriteQueue = result.catch(() => {});
    return result;
}

async function readTrekVisitors() {
    try {
        const content = await fs.readFile(trekVisitorFile, "utf8");
        const records = JSON.parse(content);
        if (!Array.isArray(records) || records.some((record) =>
            !record || typeof record.trekId !== "string" || !Array.isArray(record.visitors)
        )) {
            throw new Error("Trek visitor data file has an invalid format.");
        }
        return records;
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}

async function writeTrekVisitors(records) {
    await fs.mkdir(path.dirname(trekVisitorFile), { recursive: true });
    const temporaryFile = `${trekVisitorFile}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, `${JSON.stringify(records, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporaryFile, trekVisitorFile);
}

async function writeUsers(users) {
    await fs.mkdir(path.dirname(usersFile), { recursive: true });
    const temporaryFile = `${usersFile}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, `${JSON.stringify(users, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporaryFile, usersFile);
}

function publicUser(user) {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function createSessionToken(user) {
    const payload = Buffer.from(JSON.stringify({
        sub: user.id,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + sessionLifetimeSeconds
    })).toString("base64url");
    const signature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
}

async function getSessionUser(req) {
    const cookieHeader = req.headers.cookie || "";
    const encodedToken = cookieHeader.split(";").map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith(`${sessionCookieName}=`))
        ?.slice(sessionCookieName.length + 1);

    if (!encodedToken) {
        return null;
    }

    let token;
    try {
        token = decodeURIComponent(encodedToken);
    } catch {
        return null;
    }

    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) {
        return null;
    }

    const expectedSignature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
    if (!safeStringEqual(signature, expectedSignature)) {
        return null;
    }

    let session;
    try {
        session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
        return null;
    }

    if (!session.sub || !Number.isInteger(session.exp) || session.exp <= Math.floor(Date.now() / 1000)) {
        return null;
    }

    const users = await readUsers();
    const user = users.find((item) => item.id === session.sub && item.role === session.role);
    return user || null;
}

function setSessionCookie(res, user) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader(
        "Set-Cookie",
        `${sessionCookieName}=${encodeURIComponent(createSessionToken(user))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetimeSeconds}${secure}`
    );
}

function clearSessionCookie(res) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader(
        "Set-Cookie",
        `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
    );
}

function limitAuthAttempts(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const current = authAttempts.get(key);
    const attempt = !current || now - current.startedAt > 15 * 60 * 1000
        ? { startedAt: now, count: 0 }
        : current;

    if (attempt.count >= 20) {
        return res.status(429).json({
            success: false,
            message: "Too many account attempts. Please wait 15 minutes and try again."
        });
    }

    attempt.count += 1;
    authAttempts.set(key, attempt);
    return next();
}

async function requireUser(req, res, next) {
    try {
        req.authUser = await getSessionUser(req);
        if (!req.authUser) {
            return res.status(401).json({ success: false, message: "Please sign in to continue." });
        }
        return next();
    } catch (error) {
        console.error("Could not load signed-in user:", error);
        return res.status(500).json({ success: false, message: "Could not verify your account." });
    }
}

function requireAdmin(req, res, next) {
    if (req.authUser.role !== "admin") {
        return res.status(403).json({ success: false, message: "Admin access is required." });
    }
    return next();
}

function getAIConfigurationError() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
        return "OPENAI_API_KEY is missing. Add your key to the project .env file and restart the server.";
    }

    if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(apiKey)) {
        return "OPENAI_API_KEY does not look like a real OpenAI API key. Replace the placeholder in .env with a key from the OpenAI API platform, then restart the server.";
    }

    return null;
}

const treks = [
    {
        id: "skandagiri",
        name: "Skandagiri Sunrise",
        location: "Chikkaballapur, Karnataka",
        coordinates: { lat: 13.4005, lng: 77.6834 },
        difficulty: "Moderate",
        duration: "1 day",
        distance: "8 km",
        price: 1499,
        tag: "SUNRISE FAVOURITE",
        description: "A pre-dawn climb to cloud-kissed ruins and a wide-open sunrise.",
        image: "https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&w=1000&q=85",
        bestTime: "October to March",
        hikingTime: "About 4–6 hours on the trail; allow a full night and morning for the outing.",
        guideAvailability: "A group trek leader is planned for guided departures. Confirm the guide and departure date with the local operator.",
        safety: ["Start only with an authorized local guide and follow current entry rules.", "Carry water, a charged phone, a headlamp, and shoes with good grip for the pre-dawn rocky trail.", "Stay with your group, follow the guide’s turnaround instructions, and do not trek during unsafe weather."],
        overview: "A popular night ascent to Skandagiri's hilltop fort, timed to reach the summit for sunrise. Expect a steady uphill trail, rocky sections, and an early start.",
        itinerary: [
            { day: "Day 1 · Night", title: "Meet and begin the climb", description: "Meet your trek lead near the base, complete the check-in, and start the guided ascent after the required local entry checks." },
            { day: "Day 1 · Sunrise", title: "Summit and return", description: "Reach the hilltop before sunrise, take a rest and photos, then descend with the group and finish at the base." }
        ],
        budget: [
            { item: "Guided trek and local entry", low: 1499, high: 1499 },
            { item: "Return travel from Bengaluru", low: 800, high: 1600 },
            { item: "Meals and drinking water", low: 300, high: 600 }
        ],
        included: ["Trek leader for the group", "Basic first-aid support", "Local entry charge where included in the listed trek fee"],
        notIncluded: ["Travel to and from the trek base", "Personal meals unless confirmed by the organizer", "Personal trekking gear"]
    },
    {
        id: "kudremukh",
        name: "Kudremukh Green Trail",
        location: "Chikkamagaluru, Karnataka",
        coordinates: { lat: 13.2202, lng: 75.0201 },
        difficulty: "Challenging",
        duration: "2 days",
        distance: "22 km",
        price: 4999,
        tag: "WESTERN GHATS",
        description: "Rolling grasslands, misty ridges, and one unforgettable summit.",
        image: "https://images.unsplash.com/photo-1464278533981-50106e6176b1?auto=format&fit=crop&w=1000&q=85",
        bestTime: "October to February",
        hikingTime: "About 7–9 hours of walking on summit day; the trip spans 2 days.",
        guideAvailability: "A group trek leader is planned for guided departures. Confirm current permits, guide assignment, and access before travel.",
        safety: ["Use the currently approved route and obtain required forest permissions.", "Carry enough water, rain protection, food, and a first-aid kit; expect slippery stream and grassland sections.", "Follow the group pace and turnaround time; avoid the route during heavy rain or unsafe river conditions."],
        overview: "A challenging Western Ghats route through forest, streams, and open shola grassland to the Kudremukh summit. Trail access and permits are controlled locally and must be confirmed before travel.",
        itinerary: [
            { day: "Day 1", title: "Travel and trail briefing", description: "Reach the approved base, check in to the arranged stay, meet the trek lead, and prepare for an early start." },
            { day: "Day 2", title: "Kudremukh summit trek", description: "Start after breakfast, cross forest and rolling grassland sections with the group, reach the permitted turnaround point, and return to the base." }
        ],
        budget: [
            { item: "Trek package and local coordination", low: 4999, high: 4999 },
            { item: "Travel to and from Chikkamagaluru", low: 1200, high: 3000 },
            { item: "Meals and local stay (if not in package)", low: 1000, high: 2500 }
        ],
        included: ["Group trek lead", "Route coordination", "Basic first-aid support"],
        notIncluded: ["Travel to the base", "Stay or meals unless stated in the confirmed package", "Permit charges not included in the confirmed package"]
    },
    {
        id: "hampta",
        name: "Hampta Pass Crossing",
        location: "Manali, Himachal Pradesh",
        coordinates: { lat: 32.2396, lng: 77.1887 },
        difficulty: "Challenging",
        duration: "5 days",
        distance: "26 km",
        price: 12499,
        tag: "HIGH ALTITUDE",
        description: "Cross from lush Kullu valleys into the stark beauty of Lahaul.",
        image: "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1000&q=85",
        bestTime: "June to September (weather and route permitting)",
        hikingTime: "About 5–8 hours of walking on most trail days; total trip is 5 days.",
        guideAvailability: "A qualified high-altitude trek leader and local support must be confirmed with the operator before departure.",
        safety: ["Acclimatize as directed and tell the trek leader about altitude symptoms immediately.", "Carry warm layers, waterproof clothing, sun protection, personal medicines, and suitable trekking boots.", "Follow the guide’s weather and turnaround decisions; do not cross a high pass in unsafe conditions."],
        overview: "A multi-day Himalayan crossing that climbs from the green Kullu valley into the high-altitude landscape of Lahaul. Weather, snow, road access, and operator schedules affect the route.",
        itinerary: [
            { day: "Day 1", title: "Arrive in Manali", description: "Meet the trek team, check gear, attend the briefing, and acclimatize before the trail begins." },
            { day: "Day 2", title: "Drive to the trailhead and trek", description: "Travel to the current trailhead and hike to the first campsite with the group." },
            { day: "Day 3", title: "Climb to the high camp", description: "Continue gradually through the valley and reach the high camp, following the guide's pace and acclimatization plan." },
            { day: "Day 4", title: "Cross the pass", description: "Start early for the pass crossing, then descend toward the next campsite as conditions allow." },
            { day: "Day 5", title: "Descend and return", description: "Complete the final trail section and transfer back toward the planned endpoint." }
        ],
        budget: [
            { item: "Trek package and group logistics", low: 12499, high: 12499 },
            { item: "Travel to and from Manali", low: 2500, high: 7000 },
            { item: "Personal gear, snacks, and contingency", low: 1500, high: 4000 }
        ],
        included: ["Group trek leader", "Camps and meals only as stated in the confirmed operator package", "Group route coordination"],
        notIncluded: ["Travel to Manali", "Personal high-altitude clothing and gear", "Personal expenses and emergency evacuation cover"]
    },
    {
        id: "triund",
        name: "Triund Ridge Walk",
        location: "Dharamshala, Himachal Pradesh",
        coordinates: { lat: 32.245, lng: 76.329 },
        difficulty: "Easy",
        duration: "2 days",
        distance: "9 km",
        price: 2999,
        tag: "GREAT FIRST TREK",
        description: "An approachable forest climb with a front-row view of the Dhauladhars.",
        image: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1000&q=85",
        bestTime: "March to June and September to December",
        hikingTime: "About 4–6 hours uphill and 3–5 hours down; overnight stays change the trip to 2 days.",
        guideAvailability: "A local group guide can be arranged for guided departures. Confirm availability and any overnight arrangements in advance.",
        safety: ["Carry water, sun protection, a light rain layer, and grippy footwear for the steep forest path.", "Check weather and trail conditions before starting; allow extra daylight for the descent.", "Stay on the marked route and agree on a group turnaround time with your guide."],
        overview: "A well-known approach to a high meadow above Dharamshala, with forest on the ascent and broad views of the Dhauladhar range. The trail is steep in places, so allow time and carry water.",
        itinerary: [
            { day: "Day 1", title: "Dharamkot to Triund", description: "Start from the agreed trailhead, climb through forest with breaks, and reach the ridge. Overnight stay is optional and must be arranged separately." },
            { day: "Day 2", title: "Sunrise and descent", description: "Enjoy the morning views, then return downhill to the trailhead and Dharamshala." }
        ],
        budget: [
            { item: "Guided trek package", low: 2999, high: 2999 },
            { item: "Travel to and from Dharamshala", low: 1200, high: 3500 },
            { item: "Meals and optional overnight stay", low: 700, high: 2200 }
        ],
        included: ["Group trek leader", "Basic first-aid support", "Route briefing"],
        notIncluded: ["Travel to Dharamshala", "Overnight stay and meals unless specifically included", "Personal trekking gear"]
    },
    {
        id: "tadiandamol",
        name: "Tadiandamol Summit",
        location: "Coorg, Karnataka",
        coordinates: { lat: 12.2032, lng: 75.6353 },
        difficulty: "Moderate",
        duration: "2 days",
        distance: "14 km",
        price: 3799,
        tag: "COORG HIGHLANDS",
        description: "Follow coffee-scented paths into Coorg’s highest mountain country.",
        image: "https://images.unsplash.com/photo-1472396961693-142e6e269027?auto=format&fit=crop&w=1000&q=85",
        bestTime: "October to February",
        hikingTime: "About 5–7 hours on the trail; the planned itinerary spans 2 days.",
        guideAvailability: "A local trek leader is planned for guided departures. Confirm the guide, local access, and start time with the operator.",
        safety: ["Check local access and weather before setting out, especially during monsoon season.", "Carry water, rain protection, a charged phone, and shoes suitable for muddy slopes.", "Stay with your guide and group, and avoid stream crossings when water is high."],
        overview: "A moderate climb to Coorg's highest peak through estate country, forest, and open hillside. Local access rules and weather can change the permitted start time or route.",
        itinerary: [
            { day: "Day 1", title: "Arrive and prepare", description: "Reach the Coorg base, arrange the overnight stay, meet your trek lead, and confirm local trail access." },
            { day: "Day 2", title: "Tadiandamol summit walk", description: "Start early, hike through forest and open ridge sections, spend time at the summit, and return to the base." }
        ],
        budget: [
            { item: "Guided trek and local coordination", low: 3799, high: 3799 },
            { item: "Travel to and from Coorg", low: 1000, high: 3000 },
            { item: "Meals and overnight stay", low: 1200, high: 3000 }
        ],
        included: ["Group trek lead", "Route briefing", "Basic first-aid support"],
        notIncluded: ["Travel to the Coorg base", "Stay and meals unless confirmed in the package", "Personal trekking gear"]
    },
    {
        id: "chembra",
        name: "Chembra Peak Escape",
        location: "Wayanad, Kerala",
        coordinates: { lat: 11.529, lng: 76.105 },
        difficulty: "Moderate",
        duration: "1 day",
        distance: "7 km",
        price: 2199,
        tag: "HEART-SHAPED LAKE",
        description: "A leafy climb through Wayanad hills to a view worth slowing down for.",
        image: "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1000&q=85",
        bestTime: "September to February (subject to forest access)",
        hikingTime: "About 4–6 hours on the permitted trail; allow a full day for the outing.",
        guideAvailability: "A local guide and current forest access must be confirmed with the operator; routes and summit access may be restricted.",
        safety: ["Confirm forest department permissions and open-route status before travel.", "Carry water, rain protection, a charged phone, and suitable shoes for wet forest paths.", "Follow local guide and forest staff instructions; do not enter closed areas or approach wildlife."],
        overview: "A forested Wayanad outing toward Chembra's high viewpoints. Forest department permissions, weather, and trail closures determine which sections are open; summit access is not guaranteed.",
        itinerary: [
            { day: "Day 1", title: "Local check-in and guided hike", description: "Meet at the current approved entry point, complete local permit checks, and hike the open trail section with your guide before returning." }
        ],
        budget: [
            { item: "Guided trek and local coordination", low: 2199, high: 2199 },
            { item: "Travel within Wayanad", low: 500, high: 1800 },
            { item: "Meals and refreshments", low: 300, high: 700 }
        ],
        included: ["Group trek lead", "Basic route coordination", "First-aid support"],
        notIncluded: ["Travel to Wayanad and trailhead", "Accommodation", "Local charges not stated in the confirmed package"]
    }
];

app.use(express.json({ limit: "10kb" }));

app.get("/api/status", (req, res) => {
    const aiConfigurationError = getAIConfigurationError();
    const adminSetupCodeError = getAdminSetupCodeError();

    res.json({
        success: true,
        message: "TrekMate backend is working!",
        aiConfigured: aiConfigurationError === null,
        aiConfigurationMessage: aiConfigurationError,
        adminSetupAvailable: adminSetupCodeError === null
    });
});

app.get("/api/auth/me", async (req, res) => {
    try {
        const user = await getSessionUser(req);
        const users = await readUsers();
        const adminExists = users.some((item) => item.role === "admin");
        const adminSetupCodeError = getAdminSetupCodeError();
        res.json({
            success: true,
            user: user ? publicUser(user) : null,
            adminSetupAvailable: adminSetupCodeError === null && !adminExists,
            adminSetupMessage: adminExists
                ? "Admin setup is already complete."
                : adminSetupCodeError
        });
    } catch (error) {
        console.error("Could not load account session:", error);
        res.status(500).json({ success: false, message: "Could not load your account." });
    }
});

app.post("/api/auth/register", limitAuthAttempts, async (req, res) => {
    const { name, email, password } = req.body || {};
    const cleanName = typeof name === "string" ? name.trim() : "";
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!cleanName || cleanName.length > 80) {
        return res.status(400).json({ success: false, message: "Enter a name of up to 80 characters." });
    }
    if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }
    if (typeof password !== "string" || password.length < 10 || password.length > 128) {
        return res.status(400).json({ success: false, message: "Use a password between 10 and 128 characters." });
    }

    try {
        const user = await withUsersLock(async () => {
            const users = await readUsers();
            if (users.some((item) => item.email === cleanEmail)) {
                return null;
            }
            const salt = crypto.randomBytes(16).toString("hex");
            const hash = await scrypt(password, salt, passwordHashLength, {
                N: 16384,
                r: 8,
                p: 1,
                maxmem: 64 * 1024 * 1024
            });
            const newUser = {
                id: crypto.randomUUID(),
                name: cleanName,
                email: cleanEmail,
                role: "user",
                passwordSalt: salt,
                passwordHash: hash.toString("hex"),
                createdAt: new Date().toISOString()
            };
            users.push(newUser);
            await writeUsers(users);
            return newUser;
        });

        if (!user) {
            return res.status(409).json({ success: false, message: "An account with this email already exists." });
        }
        setSessionCookie(res, user);
        return res.status(201).json({ success: true, user: publicUser(user) });
    } catch (error) {
        console.error("Could not register user:", error);
        return res.status(500).json({ success: false, message: "Could not create your account. Please try again." });
    }
});

app.post("/api/auth/login", limitAuthAttempts, async (req, res) => {
    const { email, password } = req.body || {};
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!cleanEmail || typeof password !== "string" || password.length > 128) {
        return res.status(400).json({ success: false, message: "Enter your email and password." });
    }

    try {
        const user = (await readUsers()).find((item) => item.email === cleanEmail);
        if (!user) {
            return res.status(401).json({ success: false, message: "Email or password is incorrect." });
        }
        const suppliedHash = await scrypt(password, user.passwordSalt, passwordHashLength, {
            N: 16384,
            r: 8,
            p: 1,
            maxmem: 64 * 1024 * 1024
        });
        if (!safeStringEqual(suppliedHash.toString("hex"), user.passwordHash)) {
            return res.status(401).json({ success: false, message: "Email or password is incorrect." });
        }
        setSessionCookie(res, user);
        return res.json({ success: true, user: publicUser(user) });
    } catch (error) {
        console.error("Could not sign in:", error);
        return res.status(500).json({ success: false, message: "Could not sign in. Please try again." });
    }
});

app.post("/api/auth/admin/setup", limitAuthAttempts, async (req, res) => {
    const setupCodeError = getAdminSetupCodeError();
    if (setupCodeError) {
        return res.status(503).json({ success: false, message: setupCodeError });
    }

    const { setupCode, name, email, password } = req.body || {};
    if (typeof setupCode !== "string" || !safeStringEqual(setupCode, process.env.ADMIN_SETUP_CODE.trim())) {
        return res.status(403).json({ success: false, message: "The admin setup code is incorrect." });
    }

    const cleanName = typeof name === "string" ? name.trim() : "";
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!cleanName || cleanName.length > 80) {
        return res.status(400).json({ success: false, message: "Enter a name of up to 80 characters." });
    }
    if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
        return res.status(400).json({ success: false, message: "Use an admin password between 12 and 128 characters." });
    }

    try {
        const user = await withUsersLock(async () => {
            const users = await readUsers();
            if (users.some((item) => item.role === "admin")) {
                return { error: "Admin setup has already been completed." };
            }
            if (users.some((item) => item.email === cleanEmail)) {
                return { error: "An account with this email already exists." };
            }
            const salt = crypto.randomBytes(16).toString("hex");
            const hash = await scrypt(password, salt, passwordHashLength, {
                N: 16384,
                r: 8,
                p: 1,
                maxmem: 64 * 1024 * 1024
            });
            const admin = {
                id: crypto.randomUUID(),
                name: cleanName,
                email: cleanEmail,
                role: "admin",
                passwordSalt: salt,
                passwordHash: hash.toString("hex"),
                createdAt: new Date().toISOString()
            };
            users.push(admin);
            await writeUsers(users);
            return { user: admin };
        });

        if (user.error) {
            return res.status(409).json({ success: false, message: user.error });
        }
        setSessionCookie(res, user.user);
        return res.status(201).json({ success: true, user: publicUser(user.user) });
    } catch (error) {
        console.error("Could not set up admin account:", error);
        return res.status(500).json({ success: false, message: "Could not set up the admin account." });
    }
});

app.post("/api/auth/logout", (req, res) => {
    clearSessionCookie(res);
    res.json({ success: true });
});

app.get("/api/admin/bookings", requireUser, requireAdmin, async (req, res) => {
    try {
        const content = await fs.readFile(bookingFile, "utf8").catch((error) => {
            if (error.code === "ENOENT") {
                return "";
            }
            throw error;
        });
        const bookings = content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
        res.json({ success: true, bookings });
    } catch (error) {
        console.error("Could not load admin bookings:", error);
        res.status(500).json({ success: false, message: "Could not load trip requests." });
    }
});

app.get("/api/treks", (req, res) => {
    res.json({ success: true, treks });
});

app.post("/api/treks/:id/views", async (req, res) => {
    const trek = treks.find((item) => item.id === req.params.id);
    if (!trek) {
        return res.status(404).json({ success: false, message: "Trek not found." });
    }

    const { visitorId } = req.body || {};
    if (typeof visitorId !== "string"
        || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(visitorId)) {
        return res.status(400).json({ success: false, message: "A valid anonymous visitor ID is required." });
    }

    const visitorHash = crypto.createHash("sha256").update(visitorId).digest("hex");
    try {
        const uniqueVisitors = await withTrekVisitorsLock(async () => {
            const records = await readTrekVisitors();
            let record = records.find((item) => item.trekId === trek.id);
            if (!record) {
                record = { trekId: trek.id, visitors: [] };
                records.push(record);
            }
            if (!record.visitors.includes(visitorHash)) {
                record.visitors.push(visitorHash);
                await writeTrekVisitors(records);
            }
            return record.visitors.length;
        });
        return res.json({ success: true, uniqueVisitors });
    } catch (error) {
        console.error("Could not record trek visit:", error);
        return res.status(500).json({ success: false, message: "Could not load the visitor count." });
    }
});

app.get("/api/treks/:id", (req, res) => {
    const trek = treks.find((item) => item.id === req.params.id);
    if (!trek) {
        return res.status(404).json({ success: false, message: "Trek not found." });
    }
    return res.json({ success: true, trek });
});

app.post("/api/bookings", async (req, res) => {
    const { name, email, phone, trekId, travelDate, groupSize } = req.body || {};
    const cleanName = typeof name === "string" ? name.trim() : "";
    const cleanEmail = typeof email === "string" ? email.trim() : "";
    const cleanPhone = typeof phone === "string" ? phone.trim() : "";
    const trek = treks.find((item) => item.id === trekId);
    const validDate = typeof travelDate === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(travelDate)
        && !Number.isNaN(Date.parse(`${travelDate}T00:00:00.000Z`))
        && new Date(`${travelDate}T00:00:00.000Z`).toISOString().slice(0, 10) === travelDate
        && travelDate >= new Date().toISOString().slice(0, 10);
    const phoneDigits = cleanPhone.replace(/\D/g, "");

    if (!cleanName || cleanName.length > 80) {
        return res.status(400).json({ success: false, message: "Enter a name of up to 80 characters." });
    }
    if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }
    if (!/^[+()\d\s.-]{7,20}$/.test(cleanPhone) || phoneDigits.length < 7) {
        return res.status(400).json({ success: false, message: "Enter a valid phone number." });
    }
    if (!trek) {
        return res.status(400).json({ success: false, message: "Choose one of the available treks." });
    }
    if (!validDate) {
        return res.status(400).json({ success: false, message: "Choose a valid date today or later." });
    }
    if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > 10) {
        return res.status(400).json({ success: false, message: "Group size must be between 1 and 10." });
    }

    const booking = {
        reference: `TM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        trekId: trek.id,
        trekName: trek.name,
        travelDate,
        groupSize,
        status: "request_received",
        createdAt: new Date().toISOString()
    };

    try {
        await fs.mkdir(path.dirname(bookingFile), { recursive: true });
        await fs.appendFile(bookingFile, `${JSON.stringify(booking)}\n`, "utf8");
        return res.status(201).json({
            success: true,
            message: "Your trip request has been saved.",
            booking: { reference: booking.reference, status: booking.status }
        });
    } catch (error) {
        console.error("Could not save TrekMate trip request:", error);
        return res.status(500).json({
            success: false,
            message: "We could not save your request. Please try again later."
        });
    }
});

app.post("/api/ai", async (req, res) => {
    const { message, language = "English" } = req.body || {};

    if (typeof message !== "string" || !message.trim() || message.length > 2000) {
        return res.status(400).json({
            success: false,
            message: "Enter a question of up to 2000 characters."
        });
    }

    if (typeof language !== "string" || language.length > 40) {
        return res.status(400).json({
            success: false,
            message: "Choose a valid response language."
        });
    }

    const aiConfigurationError = getAIConfigurationError();
    if (aiConfigurationError) {
        return res.status(503).json({
            success: false,
            message: aiConfigurationError
        });
    }

    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are TrekMate, a helpful trekking and trip-planning assistant. Reply in ${language}.`
                },
                { role: "user", content: message.trim() }
            ]
        });
        const answer = completion.choices[0]?.message?.content;

        if (typeof answer !== "string" || !answer.trim()) {
            return res.status(502).json({
                success: false,
                message: "The AI service returned an empty response."
            });
        }

        return res.json({ success: true, answer: answer.trim() });
    } catch (error) {
        console.error("TrekMate AI request failed:", error);

        if (error instanceof OpenAI.APIError && error.status === 401) {
            return res.status(502).json({
                success: false,
                message: "OpenAI rejected this API key. Check that it is active and copied correctly."
            });
        }

        if (error instanceof OpenAI.APIError && error.status === 429) {
            return res.status(502).json({
                success: false,
                message: "OpenAI could not process the request because the account reached a usage limit. Check API billing and usage limits."
            });
        }

        return res.status(502).json({
            success: false,
            message: "The AI service could not complete your request."
        });
    }
});

app.use(express.static(frontendDirectory));

app.listen(PORT, () => {
    console.log("================================");
    console.log("TrekMate server is running!");
    console.log(`http://localhost:${PORT}`);
    console.log("================================");
});