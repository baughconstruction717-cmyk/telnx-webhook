// api/webhook.js
import { google } from "googleapis";
import chrono from "chrono-node";

// Authenticate with Google Calendar
const auth = new google.auth.JWT(
  JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY).client_email,
  null,
  JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY).private_key,
  ["https://www.googleapis.com/auth/calendar"]
);

const calendar = google.calendar({ version: "v3", auth });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ message: "Baugh Electric webhook is live!" });
  }

  const event = req.body;

  // 1. Greet the caller when call starts
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

  // 2. Handle speech input
  if (event.data?.event_type === "call.gather.ended") {
    const transcript = event.data.payload.transcript?.toLowerCase() || "";

    // === Forward to a human ===
    if (transcript.includes("human") || transcript.includes("representative") || transcript.includes("agent")) {
      return res.status(200).json({
        commands: [
          {
            type: "dial",
            params: {
              to: "+17177362829", // your cell/office number
              from: "+17172978787" // your Telnyx DID
            }
          }
        ]
      });
    }

    // === Scheduling with Google Calendar ===
    if (transcript.includes("schedule") || transcript.includes("appointment") || transcript.includes("book")) {
      try {
        // Try to parse a datetime from the caller’s words
        const parsedDate = chrono.parseDate(transcript, { timezone: process.env.GCAL_TZ });
        if (!parsedDate) {
          return res.status(200).json({
            commands: [
              {
                type: "speak",
                params: { voice: "female", payload: "Sure, what date and time works best for you?" }
              },
              { type: "gather_using_speech", params: { language: "en-US", speech_timeout: 5 } }
            ]
          });
        }

        const start = new Date(parsedDate);
        const end = new Date(start.getTime() + 60 * 60 * 1000); // 1-hour slot

        // Check free/busy on calendar
        const freebusy = await calendar.freebusy.query({
          requestBody: {
            timeMin: start.toISOString(),
            timeMax: end.toISOString(),
            timeZone: process.env.GCAL_TZ,
            items: [{ id: process.env.GCAL_CALENDAR_ID }]
          }
        });

        const busy = freebusy.data.calendars[process.env.GCAL_CALENDAR_ID].busy;
        if (busy.length > 0) {
          return res.status(200).json({
            commands: [
              {
                type: "speak",
                params: { voice: "female", payload: "That time is already booked. Can you suggest another time?" }
              },
              { type: "gather_using_speech", params: { language: "en-US", speech_timeout: 5 } }
            ]
          });
        }

        // Insert new event
        await calendar.events.insert({
          calendarId: process.env.GCAL_CALENDAR_ID,
          requestBody: {
            summary: "Customer Appointment - Baugh Electric",
            start: { dateTime: start.toISOString(), timeZone: process.env.GCAL_TZ },
            end: { dateTime: end.toISOString(), timeZone: process.env.GCAL_TZ },
            description: `Booked by AI Assistant. Caller: ${event.data.payload.from}`
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
        console.error("Calendar error:", err);
        return res.status(200).json({
          commands: [
            { type: "speak", params: { voice: "female", payload: "Sorry, I had trouble checking the calendar. Please try again." } }
          ]
        });
      }
    }

    // === FAQs ===
    if (transcript.includes("hours") || transcript.includes("open")) {
      return res.status(200).json({
        commands: [
          { type: "speak", params: { voice: "female", payload: "We are open Monday through Friday from 8 AM to 6 PM, and Saturdays from 9 AM to 2 PM." } },
          { type: "gather_using_speech", params: { language: "en-US", speech_timeout: 5 } }
        ]
      });
    }

    if (transcript.includes("service") || transcript.includes("repair") || transcript.includes("install")) {
      return res.status(200).json({
        commands: [
          { type: "speak", params: { voice: "female", payload: "We handle residential electrical work, HVAC installation and repair, and smart home technology services. Would you like me to connect you with a representative?" } },
          { type: "gather_using_speech", params: { language: "en-US", hints: ["human", "representative"], speech_timeout: 5 } }
        ]
      });
    }

    if (transcript.includes("location") || transcript.includes("where") || transcript.includes("address")) {
      return res.status(200).json({
        commands: [
          { type: "speak", params: { voice: "female", payload: "Baugh Electric proudly serves the greater Harrisburg, Pennsylvania area, including Mechanicsburg, Carlisle, and York." } },
          { type: "gather_using_speech", params: { language: "en-US", speech_timeout: 5 } }
        ]
      });
    }

    // === Fallback ===
    return res.status(200).json({
      commands: [
        { type: "speak", params: { voice: "female", payload: "I’m sorry, I didn’t catch that. You can ask about our hours, services, or say schedule to book a visit." } },
        { type: "gather_using_speech", params: { language: "en-US", speech_timeout: 5 } }
      ]
    });
  }

  // Catch-all
  return res.status(200).json({ message: "Baugh Electric webhook received", body: event });
}

