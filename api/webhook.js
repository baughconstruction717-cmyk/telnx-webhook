// api/webhook.js

export default function handler(req, res) {
  if (req.method === "POST") {
    const event = req.body;

    // 1. Incoming call: greet and start listening
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
              hints: ["hours", "services", "location", "human", "representative"],
              speech_timeout: 5,
              inter_digit_timeout: 2
            }
          }
        ]
      });
    }

    // 2. Handle speech input from the caller
    if (event.data?.event_type === "call.gather.ended") {
      const transcript = event.data.payload.transcript?.toLowerCase() || "";

      // Forward to a real person
      if (
        transcript.includes("human") ||
        transcript.includes("representative") ||
        transcript.includes("agent")
      ) {
        return res.status(200).json({
          commands: [
            {
              type: "dial",
              params: {
                to: "+17177362829",          // your real phone
                from: "+17172978787"         // your Telnyx DID
              }
            }
          ]
        });
      }

      // FAQ: Business hours
      if (transcript.includes("hours") || transcript.includes("open")) {
        return res.status(200).json({
          commands: [
            {
              type: "speak",
              params: {
                voice: "female",
                payload:
                  "We are open Monday through Friday from 8 AM to 6 PM, and Saturdays from 9 AM to 2 PM."
              }
            },
            {
              type: "gather_using_speech",
              params: {
                language: "en-US",
                hints: ["services", "location", "human"],
                speech_timeout: 5
              }
            }
          ]
        });
      }

      // FAQ: Services
      if (
        transcript.includes("service") ||
        transcript.includes("repair") ||
        transcript.includes("install")
      ) {
        return res.status(200).json({
          commands: [
            {
              type: "speak",
              params: {
                voice: "female",
                payload:
                  "We provide residential electrical work, HVAC installation and repair, and smart home technology services. Would you like me to connect you with a representative?"
              }
            },
            {
              type: "gather_using_speech",
              params: {
                language: "en-US",
                hints: ["human", "representative", "yes", "no"],
                speech_timeout: 5
              }
            }
          ]
        });
      }

      // FAQ: Location
      if (
        transcript.includes("location") ||
        transcript.includes("where") ||
        transcript.includes("address")
      ) {
        return res.status(200).json({
          commands: [
            {
              type: "speak",
              params: {
                voice: "female",
                payload:
                  "Baugh Electric proudly serves the greater Harrisburg, Pennsylvania area, including Mechanicsburg, Carlisle, and York."
              }
            },
            {
              type: "gather_using_speech",
              params: {
                language: "en-US",
                hints: ["human", "representative", "hours", "services"],
                speech_timeout: 5
              }
            }
          ]
        });
      }

      // Fallback if nothing matched
      return res.status(200).json({
        commands: [
          {
            type: "speak",
            params: {
              voice: "female",
              payload:
                "I’m sorry, I didn’t catch that. You can ask about our hours, services, or location. Or say representative to speak with a human."
            }
          },
          {
            type: "gather_using_speech",
            params: {
              language: "en-US",
              hints: ["human", "representative", "hours", "services", "location"],
              speech_timeout: 5
            }
          }
        ]
      });
    }

    // Default catch
    return res.status(200).json({ message: "Webhook received", body: event });
  }

  res.status(200).json({ message: "Hello from Telnyx Webhook" });
}

