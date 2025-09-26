<<<<<<< HEAD
export default function handler(req, res) {
  if (req.method === "POST") {
    console.log("Webhook received:", req.body);
    res.status(200).json({ received: true });
  } else {
    res.status(200).json({ message: "Telnyx webhook endpoint is live!" });
  }
}
=======
// api.js
export default function handler(req, res) {
  console.log("Webhook received:", req.body);
  res.status(200).json({ message: "Webhook received!" });
}

>>>>>>> 91714f9 (Initial commit for Vercel webhook)
