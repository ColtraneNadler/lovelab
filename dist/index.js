"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const intakeBot_1 = require("./intakeBot");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use(express_1.default.json());
const PORT = process.env.PORT ?? 3001;
const IG_WEBHOOK_VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN ?? 'andrea_verify_token';
const IG_BUSINESS_TOKEN = process.env.IG_BUSINESS_TOKEN ?? '';
const IG_BUSINESS_USER_ID = process.env.IG_BUSINESS_USER_ID ?? '';
// ── Send Instagram DM ──────────────────────────────────────────────────────
async function sendIgMessage(recipientIgsid, text) {
    const res = await fetch(`https://graph.instagram.com/v21.0/${IG_BUSINESS_USER_ID}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${IG_BUSINESS_TOKEN}`,
        },
        body: JSON.stringify({
            recipient: { id: recipientIgsid },
            message: { text },
        }),
    });
    const data = await res.json();
    if (data.error) {
        console.error('[ig] send error:', JSON.stringify(data.error));
    }
    else {
        console.log(`[ig] sent to ${recipientIgsid}: "${text.slice(0, 60)}..."`);
    }
}
// ── GET /webhook/instagram — Meta verification ─────────────────────────────
app.get('/webhook/instagram', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === IG_WEBHOOK_VERIFY_TOKEN) {
        console.log('[webhook] Verified');
        res.status(200).send(challenge);
    }
    else {
        res.sendStatus(403);
    }
});
// ── POST /webhook/instagram — Incoming DMs ─────────────────────────────────
app.post('/webhook/instagram', async (req, res) => {
    res.sendStatus(200); // ack immediately
    const body = req.body;
    if (body.object !== 'instagram')
        return;
    const entries = body.entry ?? [];
    for (const entry of entries) {
        const messaging = entry.messaging ?? [];
        for (const event of messaging) {
            const sender = event.sender;
            const message = event.message;
            if (!sender?.id || !message)
                continue;
            const senderId = sender.id;
            const text = message.text ?? '';
            // Ignore echoes (messages sent by us)
            if (event.sender?.id === IG_BUSINESS_USER_ID)
                continue;
            if (message.is_echo)
                continue;
            console.log(`[webhook] Message from ${senderId}: "${text}"`);
            try {
                await (0, intakeBot_1.handleIntakeMessage)(senderId, text, (reply) => sendIgMessage(senderId, reply));
            }
            catch (err) {
                console.error('[intake] Error handling message:', err);
            }
        }
    }
});
// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: "Andrea's Love Lab" });
});
app.listen(PORT, () => {
    console.log(`🌹 Andrea's Love Lab running on port ${PORT}`);
});
