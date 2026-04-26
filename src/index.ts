import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { handleIntakeMessage } from './intakeBot';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT ?? 3001;
const IG_WEBHOOK_VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN ?? 'andrea_verify_token';
const IG_BUSINESS_TOKEN = process.env.IG_BUSINESS_TOKEN ?? '';
const IG_BUSINESS_USER_ID = process.env.IG_BUSINESS_USER_ID ?? '';

// ── Send Instagram DM ──────────────────────────────────────────────────────
async function sendIgMessage(recipientIgsid: string, text: string): Promise<void> {
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
  const data = await res.json() as Record<string, unknown>;
  if (data.error) {
    console.error('[ig] send error:', JSON.stringify(data.error));
  } else {
    console.log(`[ig] sent to ${recipientIgsid}: "${text.slice(0, 60)}..."`);
  }
}

// ── GET /webhook/instagram — Meta verification ─────────────────────────────
app.get('/webhook/instagram', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === IG_WEBHOOK_VERIFY_TOKEN) {
    console.log('[webhook] Verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── POST /webhook/instagram — Incoming DMs ─────────────────────────────────
app.post('/webhook/instagram', async (req: Request, res: Response) => {
  res.sendStatus(200); // ack immediately

  const body = req.body as Record<string, unknown>;
  if (body.object !== 'instagram') return;

  const entries = (body.entry as Record<string, unknown>[]) ?? [];

  for (const entry of entries) {
    const messaging = (entry.messaging as Record<string, unknown>[]) ?? [];

    for (const event of messaging) {
      const sender = event.sender as Record<string, unknown>;
      const message = event.message as Record<string, unknown> | undefined;

      if (!sender?.id || !message) continue;

      const senderId = sender.id as string;
      const text = (message.text as string | undefined) ?? '';

      // Ignore echoes (messages sent by us)
      if ((event.sender as Record<string, unknown>)?.id === IG_BUSINESS_USER_ID) continue;
      if (message.is_echo) continue;

      console.log(`[webhook] Message from ${senderId}: "${text}"`);

      try {
        await handleIntakeMessage(
          senderId,
          text,
          (reply) => sendIgMessage(senderId, reply)
        );
      } catch (err) {
        console.error('[intake] Error handling message:', err);
      }
    }
  }
});

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: "Andrea's Love Lab" });
});

app.listen(PORT, () => {
  console.log(`🌹 Andrea's Love Lab running on port ${PORT}`);
});
