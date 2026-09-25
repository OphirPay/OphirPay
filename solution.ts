import type { NextApiRequest, NextApiResponse } from "next";
import { getSorobanServer } from "../../utils/soroban";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  const { scope, paused } = req.body;
  if (typeof scope !== "string" || typeof paused !== "boolean") {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    const server = getSorobanServer();
    const contract = new server.Contract("YOUR_CONTRACT_ID");
    // The owner must be the authenticated user; for simplicity we assume the
    // server runs with the owner key.
    await contract.invoke("set_pause_scope", scope, paused);
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to toggle pause scope" });
  }
}
