telnx-webhook/
 ├── api/
 │    └── webhook.js
 ├── package.json
 └── vercel.json   (optional but recommended)

// api/webhook.js
export default function handler(req, res) {
  if (req.method === "POST") {
    console.log("Webhook received:", req.body);
    res.status(200).json({ received: true });
  } else {
    res.status(200).json({ message: "Telnyx webhook endpoint is live!" });
  }
}
{
  "name": "telnx-webhook",
  "version": "1.0.0",
  "type": "module",
  "main": "api/webhook.js",
  "scripts": {
    "start": "vercel dev"
  }
}
{
  "version": 2,
  "builds": [
    { "src": "api/webhook.js", "use": "@vercel/node" }
  ]
}
