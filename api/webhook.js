export default function handler(req, res) {
  console.log("Webhook received:", req.body);
  res.status(200).json({ message: "Webhook received!" });
}
