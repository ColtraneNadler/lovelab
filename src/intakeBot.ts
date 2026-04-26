import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const INTAKE_DIR = process.env.INTAKE_DIR ?? path.join(__dirname, '..', 'intakes');

// Ensure intake directory exists
if (!fs.existsSync(INTAKE_DIR)) {
  fs.mkdirSync(INTAKE_DIR, { recursive: true });
}

// ── Types ─────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface IntakeAnswers {
  name?: string;
  location?: string;
  age?: string;
  gender?: string;
  lookingFor?: string;
  aboutMe?: string;
}

interface ConversationSession {
  igsid: string;
  messages: Message[];
  completed: boolean;
  answers: IntakeAnswers;
  startedAt: string;
}

interface IntakeComplete {
  __intake_complete__: true;
  name: string;
  location: string;
  age: string;
  gender: string;
  lookingFor: string;
  aboutMe: string;
}

// ── In-memory session store ───────────────────────────────────────────────

const sessions = new Map<string, ConversationSession>();

function getOrCreateSession(igsid: string): ConversationSession {
  if (!sessions.has(igsid)) {
    sessions.set(igsid, {
      igsid,
      messages: [],
      completed: false,
      answers: {},
      startedAt: new Date().toISOString(),
    });
  }
  return sessions.get(igsid)!;
}

// ── Claude system prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are messaging on behalf of Andrea, who runs Love Lab, a matchmaking service. You're collecting info from someone who reached out to be matched. Your tone is Andrea's actual voice: casual, real, warm but not over the top. Like a friend who also happens to be a matchmaker.

You need to collect these 6 things, one at a time:
1. Their full name
2. Their location (city and country)
3. Their age
4. Their gender / how they identify
5. What they're looking for in a partner (relationship type, preferences, dealbreakers)
6. A little about themselves: personality, hobbies, lifestyle

Voice rules:
- Sound like a real person texting, not a chatbot or customer service rep
- Short messages only. 1 to 3 sentences max. This is Instagram DM.
- Ask ONE question per message. Never stack questions.
- No double dashes. No em dashes. Use a period or comma instead.
- No more than one emoji per message, often zero. Only use one if it genuinely fits.
- No "Great!" or "Perfect!" or "Awesome!" reactions. Just move naturally to the next question.
- If they're vague or off-topic, redirect in a chill way without making it feel like a form.
- Do NOT say things like "intake," "process," "service," or anything that sounds corporate.
- Once you have all 6 answers clearly, end your final message with EXACTLY this JSON on a new line (it will be stripped before sending):
{"__intake_complete__": true, "name": "...", "location": "...", "age": "...", "gender": "...", "lookingFor": "...", "aboutMe": "..."}`;

// ── Parse completion JSON from Claude response ────────────────────────────

function parseCompletion(text: string): { visibleText: string; complete: IntakeComplete | null } {
  const jsonMatch = text.match(/\{"__intake_complete__":.*\}/);
  if (!jsonMatch) return { visibleText: text.trim(), complete: null };

  try {
    const complete = JSON.parse(jsonMatch[0]) as IntakeComplete;
    const visibleText = text.replace(jsonMatch[0], '').trim();
    return { visibleText, complete };
  } catch {
    return { visibleText: text.trim(), complete: null };
  }
}

// ── Save completed intake to file ─────────────────────────────────────────

function saveIntake(session: ConversationSession, answers: IntakeComplete): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${session.igsid}_${timestamp}.json`;
  const filepath = path.join(INTAKE_DIR, filename);

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

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`[intake] Saved: ${filename}`);
}

// ── Main intake handler ───────────────────────────────────────────────────

export async function handleIntakeMessage(
  igsid: string,
  userMessage: string,
  sendReply: (text: string) => Promise<void>
): Promise<void> {
  const session = getOrCreateSession(igsid);

  // Already completed
  if (session.completed) {
    await sendReply("You're already in! Andrea will reach out soon.");
    return;
  }

  // First contact — send welcome + first question (ignore any initial text)
  if (session.messages.length === 0) {
    const welcome = "Hey! So glad you reached out. I just need a few things from you to get started. What's your name?";
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

    const closing = visibleText || `That's everything, ${complete.name}. Andrea will go through your profile and reach out soon 🌹`;
    await sendReply(closing);
  } else {
    await sendReply(visibleText);
  }
}
