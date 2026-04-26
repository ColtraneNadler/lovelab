"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleIntakeMessage = handleIntakeMessage;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const anthropic = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
const INTAKE_DIR = process.env.INTAKE_DIR ?? path_1.default.join(__dirname, '..', 'intakes');
// Ensure intake directory exists
if (!fs_1.default.existsSync(INTAKE_DIR)) {
    fs_1.default.mkdirSync(INTAKE_DIR, { recursive: true });
}
// ── In-memory session store ───────────────────────────────────────────────
const sessions = new Map();
function getOrCreateSession(igsid) {
    if (!sessions.has(igsid)) {
        sessions.set(igsid, {
            igsid,
            messages: [],
            completed: false,
            answers: {},
            startedAt: new Date().toISOString(),
        });
    }
    return sessions.get(igsid);
}
// ── Claude system prompt ──────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the intake assistant for Andrea's Love Lab, a premium matchmaking service. Your job is to warmly and conversationally collect the following information from the person messaging:

1. Their full name
2. Their location (city and country)
3. Their age
4. Their gender / how they identify
5. What they are looking for in a partner (relationship type, preferred gender, any important preferences or dealbreakers)
6. A brief "tell us about yourself" — personality, hobbies, lifestyle

Rules:
- Be warm, fun, and encouraging — this is exciting for them!
- Ask ONE question at a time. Never ask multiple questions in one message.
- If they go off-topic or give an unclear answer, gently redirect to the current question.
- Do NOT proceed to the next question until the current one is clearly answered.
- Keep messages short — this is Instagram DM, 2-3 sentences max per message.
- Once you have all 6 pieces of information clearly confirmed, end your final message with EXACTLY this JSON on its own line (this will be stripped before sending to the user):
{"__intake_complete__": true, "name": "...", "location": "...", "age": "...", "gender": "...", "lookingFor": "...", "aboutMe": "..."}`;
// ── Parse completion JSON from Claude response ────────────────────────────
function parseCompletion(text) {
    const jsonMatch = text.match(/\{"__intake_complete__":.*\}/);
    if (!jsonMatch)
        return { visibleText: text.trim(), complete: null };
    try {
        const complete = JSON.parse(jsonMatch[0]);
        const visibleText = text.replace(jsonMatch[0], '').trim();
        return { visibleText, complete };
    }
    catch {
        return { visibleText: text.trim(), complete: null };
    }
}
// ── Save completed intake to file ─────────────────────────────────────────
function saveIntake(session, answers) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${session.igsid}_${timestamp}.json`;
    const filepath = path_1.default.join(INTAKE_DIR, filename);
    const data = {
        igsid: session.igsid,
        completedAt: new Date().toISOString(),
        answers: {
            name: answers.name,
            location: answers.location,
            age: answers.age,
            gender: answers.gender,
            lookingFor: answers.lookingFor,
            aboutMe: answers.aboutMe,
        },
        conversationHistory: session.messages,
    };
    fs_1.default.writeFileSync(filepath, JSON.stringify(data, null, 2));
    console.log(`[intake] Saved: ${filename}`);
}
// ── Main intake handler ───────────────────────────────────────────────────
async function handleIntakeMessage(igsid, userMessage, sendReply) {
    const session = getOrCreateSession(igsid);
    // Already completed
    if (session.completed) {
        await sendReply("Your profile is already submitted! Andrea will be in touch soon. 💕");
        return;
    }
    // First contact — send welcome + first question (ignore any initial text)
    if (session.messages.length === 0) {
        const welcome = "Welcome to Andrea's Love Lab! 💕 I'm so excited you're here. I just have a few quick questions to find your perfect match. First — what's your name?";
        session.messages.push({ role: 'assistant', content: welcome });
        await sendReply(welcome);
        return;
    }
    // Append user message
    session.messages.push({ role: 'user', content: userMessage });
    // Call Claude
    const response = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: session.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const rawText = response.content[0].type === 'text' ? response.content[0].text : '';
    const { visibleText, complete } = parseCompletion(rawText);
    // Append assistant message (raw, so history is accurate)
    session.messages.push({ role: 'assistant', content: rawText });
    if (complete) {
        session.completed = true;
        session.answers = {
            name: complete.name,
            location: complete.location,
            age: complete.age,
            gender: complete.gender,
            lookingFor: complete.lookingFor,
            aboutMe: complete.aboutMe,
        };
        saveIntake(session, complete);
        const closing = visibleText || `Thanks, ${complete.name}! 🌹 Andrea will review your profile and reach out soon. Stay tuned!`;
        await sendReply(closing);
    }
    else {
        await sendReply(visibleText);
    }
}
