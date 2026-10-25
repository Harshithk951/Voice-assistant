// test-call.js - Quick test script to verify Twilio outbound calling to your phone
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync(path.join(ROOT, '.env'))) {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, OWNER_NUMBER } = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !OWNER_NUMBER) {
  console.error('\n❌ Missing required configuration in .env!');
  console.log('Please make sure you have filled in:');
  console.log('  OWNER_NUMBER        = ' + (OWNER_NUMBER || '(missing)'));
  console.log('  TWILIO_ACCOUNT_SID  = ' + (TWILIO_ACCOUNT_SID || '(missing)'));
  console.log('  TWILIO_AUTH_TOKEN   = ' + (TWILIO_AUTH_TOKEN ? '••••••••' : '(missing)'));
  console.log('  TWILIO_FROM_NUMBER  = ' + (TWILIO_FROM_NUMBER || '(missing)'));
  console.log('\nEdit your .env file and run "node test-call.js" again.\n');
  process.exit(1);
}

const to = OWNER_NUMBER.startsWith('+') ? OWNER_NUMBER : `+${OWNER_NUMBER.replace(/\D/g, '')}`;
const from = TWILIO_FROM_NUMBER.startsWith('+') ? TWILIO_FROM_NUMBER : `+${TWILIO_FROM_NUMBER.replace(/\D/g, '')}`;
const message = "Hi! This is Siri. Your voice assistant is now connected and can call your phone successfully. Have a great day!";
const twiml = `<Response><Pause length="1"/><Say voice="Polly.Aditi" language="en-IN">${message}</Say></Response>`;
const twimletUrl = `https://twimlets.com/echo?Twiml=${encodeURIComponent(twiml)}`;

console.log(`\n📞 Initiating test call to ${to} from ${from}...`);

const params = new URLSearchParams({ To: to, From: from, Url: twimletUrl });
const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Calls.json`;

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (res.ok) {
    console.log(`\n✅ Call successfully placed!`);
    console.log(`   Call SID: ${data.sid}`);
    console.log(`   Status:   ${data.status}`);
    console.log(`\n📱 Your phone should start ringing in a few seconds! Answer it to hear ARRC.\n`);
  } else {
    console.error(`\n❌ Call failed (${res.status}):`, data.message || data);
  }
} catch (e) {
  console.error('\n❌ Network or fetch error:', e.message);
}
