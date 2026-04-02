require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const BOOKING_URL = 'https://api.leadconnectorhq.com/widget/bookings/brand-me-now-sales';

async function testGeneration() {
  const candidate = {
    firstName: 'Brittney',
    lastName: 'Bouchard',
    email: 'brittneybouchard@me.com',
    instantlyConversation: [
      "[outbound] ryan@brandmenow.io: Hi\n\nI've been following your content. I think it's great and I love it. Are you open to brand partnerships in the health & wellness space?",
      "[outbound] grayson@brandmenow.shop: Hi,\n\nJust bumping this to the top of your inbox in case it got buried. Would love to hear your thoughts on a potential health & wellness partnership.",
      "[inbound] brittneybouchard@me.com: Can you give me more details? Name of brand / products?",
      "[outbound] grayson@brandmenow.shop: Hi Brittney, Great questions. This is a bit different from a typical brand deal — we actually help creators launch their OWN branded product line."
    ]
  };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const name = candidate.firstName || 'there';
  const conversationContext = candidate.instantlyConversation.join('\n\n---\n\n');

  console.log('=== GENERATING 4-EMAIL SEQUENCE FOR BRITTNEY ===\n');

  const prompt = `You are Ryan from Brand Me Now, writing warm follow-up emails to a creator who showed interest in our cold outreach on Instantly. They're now in our GHL CRM and you need to move them toward booking a discovery call.

CREATOR INFO:
- Name: ${name}${candidate.lastName ? ' ' + candidate.lastName : ''}
- Email: ${candidate.email}

PREVIOUS INSTANTLY CONVERSATION:
${conversationContext}

ABOUT BRAND ME NOW:
Brand Me Now is an AI-powered brand creation platform for influencers and creators. We handle everything — product development, manufacturing, fulfillment, and brand design. Creators get their own branded product line with zero inventory risk and earn 20% royalty on every sale. 200+ SKU catalog across beauty, wellness, lifestyle, and apparel.

YOUR GOAL:
Generate a 4-email warm follow-up sequence. The goal is to get ${name} on a discovery call. The booking link is: ${BOOKING_URL}

CRITICAL TONE RULES:
- Sound like a REAL PERSON, not AI. Short sentences. Casual. Warm.
- Reference the previous Instantly conversation so they recognize you
- Each email should have a different angle/hook
- No corporate jargon. No "I hope this email finds you well."
- Keep emails under 100 words each
- Do NOT use excessive exclamation marks or sound overly enthusiastic

OUTPUT FORMAT — return ONLY valid JSON array:
[
  {
    "step": 1,
    "subject": "subject line",
    "body": "plain text email body"
  },
  ...4 total
]

Only output the JSON array. No other text.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  console.log('Raw Claude output:\n');
  console.log(text);

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const emails = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    console.log('\n=== PARSED EMAILS ===\n');
    for (const e of emails) {
      console.log(`--- Step ${e.step} ---`);
      console.log(`Subject: ${e.subject}`);
      console.log(`Body (${e.body.length} chars):`);
      console.log(e.body);
      console.log();
    }
  } catch(err) {
    console.error('Parse error:', err.message);
  }
}

testGeneration().catch(console.error);
