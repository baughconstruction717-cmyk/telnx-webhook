// api/webhook.js
import { google } from "googleapis";
import chrono from "chrono-node";

/** ---------- SAFE STARTUP LOGS (no secrets) ---------- **/
const mask = (v) => {
  if (!v) return "MISSING";
  const s = String(v);
  return s.slice(0, 6) + "… (" + s.length + " chars)";
};

console.log("🔧 Booting Baugh Electric webhook…");
console.log("Env check:", {
  hasKey: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,   // true/false only
  calendarId: mask(process.env.GCAL_CALENDAR_ID),    // masked
  timezone: process.env.GCAL_TZ || "MISSING"
});

/** ---------- Load service account key (raw JSON or base64) ---------- **/
function loadServiceAccountKey() {
  const keyString = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyString) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is missing");

  try {
    // Raw JSON?
    if (keyString.trim().startsWith("{")) return JSON.parse(keyString);
    // Otherwise assume base64
    return JSON.parse(Buffer.from(keyString, "base64").toString());
  } catch (err) {
    console.error("❌ Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:", err?.message);
    throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT_KEY format");
  }
}

/** ---------- Initialize Google Calendar client (never throw) ---------- **/
let calendar = null;
let auth = null;
let calInitError = null;

try {
  const svc = loadServiceAccountKey();
  auth = new google.auth.JWT(
    svc.client_email,
    null,
    svc.private_key,
    ["https://www.googleapis.com/auth/calendar"]
  );
  calendar = google.calendar({ version: "v3", auth });
  console.log("✅ Google Calendar client initialized (email:", mask(svc.client_email), ")");
} catch (e) {
  calInitError = e;
  console.error("❌ Calendar init error:", e?.message);
}

/** ---------- Main handler (crash-proof) ---------- **/
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      // Health endpoint: also return quick debug info
      return res.status(200).json({
        ok: true,
        message: "Baugh Electric webhook is live",
        debug: {
          hasKey: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
          calendarId: mask(process.env.GCAL_CALENDAR_ID),
          timezone: process.env.GCAL_TZ || "MISSING",
          calendarReady: !!calendar,
          calInitError: calInitError?.message || null
        }
      });
    }

    const event = req.body;
    console.log("📨 Incoming event:", event?.data?.event_type || "unknown");

    // 1) Greeting on call start
    if (event.data?.event_type === "call.initiated") {
      return res.status(200).json({
        commands: [
          {
            type: "speak",
            params: {
              voice: "female",
              payload:
                "Hello, thanks for calling Baugh Electric, your trusted local electrical and HVAC experts. How can I help you today?"
            }
          },
          {
            type: "gather_using_speech",
            params: {
              language: "en-US",
              hints: ["hours", "services", "location", "schedule", "appointment", "human", "representative"],
              speech_timeout: 5
            }
          }
        ]
      });
    }

    // 2) Caller speech
    if (event.data?.event_type === "call.gather.ended") {
      const transcript = (event.data?.payload?.transcript || "").toLowerCase();
      console.log("📝 Transcript:", transcript);

      // Forward to human
      if (/\b(human|representative|agent)\b/.test(transcript)) {
        return res.status(200).json({
          commands: [
            {
              type: "dial",
              params: { to: "+17177362829", from: "+17172978787" }
            }
          ]
        });
      }

      // Scheduling path
      if (/\b(schedule|appointment|book)\b/.test(transcript)) {
        // If calendar client failed to init, don't crash—return debug + graceful voice
        if (!calendar) {
          console.error("🚫 Calendar unavailable:", calInitError?.message);
          return res.status(200).json({
            commands: [
              {
                type: "speak",
                params: {
                  voice: "female",
                  payload:
                    "I'm having trouble reaching our calendar right now. Let me connect you with a representative."
                }
              },
              { type: "dial", params: { to: "+17177362829", from: "+17172978787" } }
            ],
            debug: {
              calendarReady: false,
              calInitError: calInitError?.message || "unknown"
            }
          });
        }

        try {
          const tz = process.env.GCAL_TZ || "America/New_York";
          const calId = process.env.GCAL_CALENDAR_ID;
          if (!calId) throw new Error("GCAL_CALENDAR_ID missing");

          // Parse natural language time
          const parsedDate = chrono.parseDate(transcript, { timezone: tz });
          console.log("📅 Parsed date:", parsedDate);

          if (!parsedDate) {
            return res.status(200).json({
              commands: [
                {
                  type: "speak",
                  params: { voice: "female", payload: "Sure—what date and time works best for you?" }
                },
                { type: "gather_using_speech", params: { language: "en-US", speech_timeout: 5 } }
              ]
            });
          }

          const start = new Date(parsedDate);
          const end = new Date(start.getTime() + 60 * 60 * 1000);

          // Optional: ensure JWT is authorized
          try {
            await auth.authorize();
          } catch (e) {
            console.error("🔐 JWT authorize error:", e?.message);
          }

          // Check free/busy
          const fb = await calendar.freebusy.query({
            requestBody: {
              timeMin: start.toISOString(),
              timeMax: end.toISOString(),
              timeZone: tz,
              items: [{ id: calId }]
            }
          });

          const busy = fb?.data?.calendars?.[calId]?.busy || [];
          console.log("⏰ Busy windows:", busy);

          if (busy.length > 0) {
            return res.status(200).json({
              commands: [
                {
                  type: "speak",
                  params: {
                    voice: "female",
                    payload: "That time is already booked. Is there another time that works?"
                  }
                },
                { type: "gather_using_speech", params: { language: "en-US", speech_timeout: 5 } }
              ]
            });
          }

          // Insert event
          await calendar.events.insert({
            calendarId: calId,
            requestBody: {
              summary: "Customer Appointment - Baugh Electric",
              start: { dateTime: start.toISOString(), timeZone: tz },
              end: { dateTime: end.toISOString(), timeZone: tz },
              description: `Booked by AI Assistant. Caller: ${event.data?.payload?.from || "unknown"}`
            }
          });

          return res.status(200).json({
            commands: [
              {
                type: "speak",
                params: {
                  voice: "female",
                  payload: `Great, I've scheduled your appointment for ${start.toLocaleString()}.`
                }
              }
            ]
          });
        } catch (err) {
          console.error("❌ Calendar operation error:", err?.message);
          return res.status(200).json({
            commands: [
              {
                type: "speak",
                params: {
                  voice: "female",
                  payload:
                    "I ran into an issue accessing our calendar. Let me connect you with a representative."
                }
              },
              { type: "dial", params: { to: "+17177362829", from: "+17172978787" } }
            ],
            debug: { error: err?.message || String(err) }
          });
        }
      }

      // FAQs
      if (/\b(hours|open)\b/.test(transcript)) {
        return res.status(200).json({
          commands: [
            { type: "speak", params: { voice: "female", payload: "We’re open Mon–Fri 8 AM–6 PM, and Sat 9 AM–2 PM." } },
            { type: "gather_using_speech", params: { language: "en-US", speech_timeout: 5 } }
          ]
        });
      }
      if (/\b(service|repair|install)\b/.test(transcript)) {
        return res.status(200).json({
          commands: [
            { type: "speak", params: { voice: "female", payload: "We handle residential electrical, HVAC install & repair, and smart home services. Want a representative?" } },
            { type: "gather_using_speech", params: { language: "en-US", hints: ["human", "representative"], speech_timeout: 5 } }
          ]
        });
      }
      if (/\b(location|where|address)\b/.test(transcript)) {
        return res.status(200).json({
          commands: [
            { type: "speak", params: { voice: "female", payload: "Baugh Electric serves greater Harrisburg, including Mechanicsburg, Carlisle, and York." } },
            { type: "gather_using_speech", params: { language: "en-US", speech_timeout: 5 } }
          ]
        });
      }

      // Fallback
      return res.status(200).json({
        commands: [
          {
            type: "speak",
            params: {
              voice: "female",
              payload: "I didn’t catch that. You can ask about hours, services, or say schedule to book a visit."
            }
          },
          { type: "gather_using_speech", params: { language: "en-US", speech_timeout: 5 } }
        ]
      });
    }

    // Unknown path (still respond)
    return res.status(200).json({ ok: true, message: "Webhook received", body: event });
  } catch (err) {
    console.error("💥 Unhandled error:", err?.message);
    // Never crash—be helpful to caller
    return res.status(200).json({
      commands: [
        {
          type: "speak",
          params: {
            voice: "female",
            payload: "Sorry, something went wrong. I’ll connect you with a representative."
          }
        },
        { type: "dial", params: { to: "+17177362829", from: "+17172978787" } }
      ]
    });
  }
}

