import twilioLib from 'twilio';

const client = twilioLib(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

// Starts a WhatsApp-only OTP verification for the given E.164 phone number.
// No SMS fallback — channel is always 'whatsapp'. Throws on any Twilio error
// (invalid number, WhatsApp unavailable, rate limited, etc.) — callers should
// catch and surface a friendly message rather than exposing the raw error.
export async function startWhatsappVerification(phoneNumber) {
  await client.verify.v2.services(serviceSid).verifications.create({
    to: phoneNumber,
    channel: 'whatsapp',
  });
}

// Checks a submitted code against Twilio Verify. Returns true only if the
// code was correct and the verification is still valid (not expired).
export async function checkWhatsappVerification(phoneNumber, code) {
  const check = await client.verify.v2.services(serviceSid).verificationChecks.create({
    to: phoneNumber,
    code,
  });
  return check.status === 'approved';
}
