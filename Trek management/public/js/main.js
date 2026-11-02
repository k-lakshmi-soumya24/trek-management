// ==========================================
// TREKMATE FRONTEND JAVASCRIPT
// ==========================================


// ==========================================
// EXPLORE TREKS
// ==========================================

function exploreTreks() {

    document
        .getElementById("treks")
        .scrollIntoView({
            behavior: "smooth"
        });

}


// ==========================================
// AI SECTION
// ==========================================

function openAIPlanner() {

    document
        .getElementById("ai")
        .scrollIntoView({
            behavior: "smooth"
        });

}


// ==========================================
// ASK AI
// ==========================================

async function askAI() {

    const input =
        document.getElementById("aiQuestion");

    const answerBox =
        document.getElementById("aiAnswer");

    const submitButton =
        document.querySelector("#aiForm .ask-button");

    const language =
        document.getElementById("language").value;


    const question =
        input.value.trim();


    if (!question) {

        answerBox.innerHTML =
            "<p>Please enter a question.</p>";

        return;

    }


    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    submitButton.disabled = true;
    answerBox.classList.add("loading");
    answerBox.textContent = "TrekMate AI is thinking…";

    try {
        const response = await fetch(
            "/api/ai",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    message: question,
                    language: language
                }),
                signal: controller.signal
            }
        );

        const data = await response.json().catch(() => null);

        if (!response.ok || !data || !data.success) {
            throw new Error(
                data?.message ||
                "AI request failed"
            );
        }

        if (typeof data.answer !== "string") {
            throw new Error("The AI response was invalid.");
        }

        answerBox.classList.remove("loading");
        answerBox.innerHTML = `<p>${formatAnswer(data.answer)}</p>`;
    } catch (error) {
        console.error(error);
        answerBox.classList.remove("loading");

        const errorMessage =
            error instanceof DOMException && error.name === "AbortError"
                ? "The AI request took too long. Please try again."
                : error instanceof Error
                    ? error.message
                : "Unable to connect to TrekMate AI.";
        const errorParagraph =
            document.createElement("p");

        errorParagraph.textContent =
            `❌ ${errorMessage}`;
        answerBox.replaceChildren(errorParagraph);
    } finally {
        window.clearTimeout(timeout);
        submitButton.disabled = false;
    }

}


// ==========================================
// FORMAT AI ANSWER
// ==========================================

function formatAnswer(text) {

    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/\n/g, "<br>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

}


// ==========================================
// VOICE INPUT
// ==========================================

function startVoiceInput() {

    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;


    if (!SpeechRecognition) {

        alert(
            "Voice recognition is not supported in this browser."
        );

        return;

    }


    const recognition =
        new SpeechRecognition();


    recognition.continuous = false;

    recognition.interimResults = false;

    recognition.lang =
        getSpeechLanguage();


    recognition.start();


    const answerBox =
        document.getElementById("aiAnswer");


    answerBox.innerHTML =
        "<p>🎤 Listening...</p>";


    recognition.onresult =
        function(event) {

            const transcript =
                event.results[0][0].transcript;


            document.getElementById(
                "aiQuestion"
            ).value = transcript;


            askAI();

        };


    recognition.onerror =
        function(event) {

            console.error(
                "Voice error:",
                event.error
            );


            answerBox.innerHTML =
                "<p>❌ Could not hear you. Please try again.</p>";

        };

}


// ==========================================
// LANGUAGE FOR SPEECH INPUT
// ==========================================

function getSpeechLanguage() {

    const language =
        document.getElementById(
            "language"
        ).value;


    const languages = {

        "English": "en-IN",

        "Hindi": "hi-IN",

        "Kannada": "kn-IN",

        "Tamil": "ta-IN",

        "Telugu": "te-IN",

        "Malayalam": "ml-IN",

        "Marathi": "mr-IN"

    };


    return languages[language]
        || "en-IN";

}


// ==========================================
// TEXT TO SPEECH
// ==========================================

function speakAIAnswer() {

    const answerBox =
        document.getElementById(
            "aiAnswer"
        );


    const text =
        answerBox.innerText;


    if (!text ||
        text.includes("Your trail questions are welcome here.") ||
        answerBox.classList.contains("loading")) {

        alert(
            "Ask the AI a question first."
        );

        return;

    }


    window.speechSynthesis.cancel();


    const speech =
        new SpeechSynthesisUtterance(
            text
        );


    speech.lang =
        getSpeechLanguage();


    speech.rate = 0.9;

    speech.pitch = 1;


    window.speechSynthesis.speak(
        speech
    );

}


// ==========================================
// TREK VIEW
// ==========================================

function viewTrek(trekName) {

    alert(
        trekName +
        "\n\nDetailed trek page will be connected to the backend next."
    );

}


// ==========================================
// MAP
// ==========================================

function openMap() {

    alert(
        "Interactive map will be connected next."
    );

}


// ==========================================
// PAGE LOAD
// ==========================================

console.log(
    "TrekMate frontend loaded."
);