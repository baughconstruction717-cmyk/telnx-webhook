// api/webhook.js
import { google } from "googleapis";
import chrono from "chrono-node";

// Mask helper for logging
const mask = (v) => {
  if (!v) return "MISSING";
  const s = String(v);
  return s.slice(0, 6) + "… (" + s.length + " chars)";
};

// Log environment status (no secrets shown)
console.log("🔧 Booting webhook...");
console.log("Env check:", {
  hasKey: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
  calendarId: mask(process.env.GCAL_CALENDAR_ID),
  timezone: process.env.GCAL_TZ || "MISSING"
});

// Try to init Google Calendar
let calendar = null;
let auth = null;
let calInitError = null;

try {
  const keyString = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyString) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY missing");

  const svc = keyString.trim().startsWith("{")
    ? JSON.parse(keyString)
    : JSON.parse(Buffer.from(keyString, "base64").toString());

  auth = new google.auth.JWT(
    svc.client_email,
    null,
    svc.private_key,
    ["https://www.googleapis.com/auth/calendar"]
  );

  calendar = google.calendar({ version: "v3", auth });
  console.log("✅ Google Calendar client initialized:", mask(svc.client_email));
} catch (err) {
  calInitError = err;
  console.error("❌ Calendar init failed:", err.message);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({
        ok: true,
        message: "Baugh Electric webhook live",
        debug: {
          calendarReady: !!calendar,
          calInitError: calInitError?.message || null
        }
      });
    }

    const event = req.body;
    console.log("📨 Incoming:", event?.data?.event_type);

    // Example: scheduling path
    if (event.data?.event_type === "call.gather.ended") {
      const transcript = (event.data.payload?.transcript || "").toLowerCase();
      console.log("📝 Transcript:", transcript);

      if (transcript.includes("schedule") || transcript.includes("appointment")) {
        if (!calendar) {
          console.error("🚫 Calendar unavailable:", calInitError?.message);
          return res.status(200).json({
            commands: [
              {
                type: "speak",
                params: { voice: "female", payload: "Our calendar is temporarily unavailable, transferring you now." }
              },
              { type: "dial", params: { to: "+17177362829", from: "+17172978787" } }
            ]
          });
        }

        try {
          await auth.authorize();
          console.log("🔑 Authorized with Google API");

          const tz = process.env.GCAL_TZ || "America/New_York";
          const calId = process.env.GCAL_CALENDAR_ID;
          const parsedDate = chrono.parseDate(transcript, { timezone: tz });

          console.log("📅 Parsed date:", parsedDate);

          if (!parsedDate) {
            return res.status(200).json({
              commands: [
                { type: "speak", params: { voice: "female", payload: "What day and time works best for you?" } },
                { type: "gather_using_speech", params: { language: "en-US", speech_timeout: 5 } }
              ]
            });
          }

          const start = new Date(parsedDate);
          const end = new Date(start.getTime() + 60 * 60 * 1000);

          const fb = await calendar.freebusy.query({
            requestBody: {
              timeMin: start.toISOString(),
              timeMax: end.toISOString(),
              items: [{ id: calId }]
            }
          });

          console.log("⏰ Free/busy result:", fb.data);

          const busy = fb.data.calendars[calId].busy;
          if (busy.length > 0) {
            return res.status(200).json({
              commands: [
                { type: "speak", params: { voice: "female", payload: "That time is already booked, please suggest another." } },
                { type: "gather_using_speech", params: { language: "en-US", speech_timeout: 5 } }
              ]
            });
          }

          await calendar.events.insert({
            calendarId: calId,
            requestBody: {
              summary: "Customer Appointment - Baugh Electric",
              start: { dateTime: start.toISOString(), timeZone: tz },
              end: { dateTime: end.toISOString(), timeZone: tz }
            }
          });

          return res.status(200).json({
            commands: [
              { type: "speak", params: { voice: "female", payload: `Your appointment is set for ${start.toLocaleString()}.` } }
            ]
          });
        } catch (e) {
          console.error("❌ Calendar scheduling error:", e.message);
        }
      }
    }

    return res.status(200).json({ ok: true, message: "Handled default path" });
  } catch (err) {
    console.error("💥 Unhandled error:", err.message);
    return res.status(200).json({
      commands: [
        { type: "speak", params: { voice: "female", payload: "Sorry, there was an error. Forwarding to a representative." } },
        { type: "dial", params: { to: "+17177362829", from: "+17172978787" } }
      ]
    });
  }
}

