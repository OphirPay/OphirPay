import { test, expect } from "@playwright/test";
import { createServer } from "http";
import crypto from "crypto";
import { PrismaClient, User } from "@prisma/client";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const prisma = new PrismaClient();

function createMockServer() {
  const requests: { headers: unknown; body: unknown }[] = [];
  let rejectNext = false;
  let serverResolver: () => void = () => {};
  let hasReceivedRequest = new Promise<void>((r) => (serverResolver = r));

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      let parsedBody: unknown = body;
      try { parsedBody = JSON.parse(body); } catch {}

      requests.push({ headers: req.headers, body: parsedBody });
      
      if (rejectNext) {
        rejectNext = false;
        res.writeHead(500);
        res.end();
      } else {
        res.writeHead(200);
        res.end(JSON.stringify({ received: true }));
      }
      
      serverResolver();
    });
  });

  return {
    server,
    requests,
    setRejectNext: (val: boolean) => { rejectNext = val; },
    waitForRequest: async () => {
      await hasReceivedRequest;
      hasReceivedRequest = new Promise<void>((r) => (serverResolver = r));
    },
    start: async () => {
      return new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address() as import("net").AddressInfo;
          resolve(addr.port);
        });
      });
    },
    close: () => {
      server.close();
    },
  };
}

test.describe("Webhook Delivery & Retry Flow", () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let port: number;
  let user: User;
  let rawApiKey: string;
  let webhookSecret: string;

  test.beforeAll(async () => {
    mockServer = createMockServer();
    port = await mockServer.start();

    const stellarAddress = "G" + crypto.randomBytes(30).toString("hex").toUpperCase().slice(0, 55);
    user = await prisma.user.create({
      data: { stellarAddress },
    });

    rawApiKey = "sk_test_" + crypto.randomBytes(16).toString("hex");
    const prefix = rawApiKey.slice(0, 8);
    const keyHash = crypto.createHash("sha256").update(rawApiKey).digest("hex");

    await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: "E2E Test Key",
        prefix,
        keyHash,
      },
    });
  });

  test.afterAll(async () => {
    mockServer.close();
    await prisma.apiKey.deleteMany({ where: { userId: user.id } });
    await prisma.webhook.deleteMany({ where: { userId: user.id } });
    await prisma.payment.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  });

  test("verifies full webhook lifecycle (register, fail, retry, success, signature)", async ({ request }) => {
    const webhookUrl = `http://localhost:${port}/hook`;
    const regRes = await request.post(`${BASE_URL}/api/webhooks`, {
      headers: { Authorization: `Bearer ${rawApiKey}` },
      data: {
        url: webhookUrl,
        events: ["payment.created"],
        isActive: true,
      },
    });
    
    expect(regRes.status()).toBe(201);
    const regData = await regRes.json();
    expect(regData.success).toBe(true);
    webhookSecret = regData.data.secret;
    expect(webhookSecret).toBeDefined();

    mockServer.setRejectNext(true);

    const paymentRes = await request.post(`${BASE_URL}/api/payments`, {
      headers: { Authorization: `Bearer ${rawApiKey}` },
      data: {
        amount: 100,
        sourceAccountId: user.stellarAddress,
        destAddress: user.stellarAddress,
        assetCode: "XLM",
        description: "Test Webhook Retry",
      },
    });
    
    expect(paymentRes.status()).toBe(201);

    await expect.poll(
      () => mockServer.requests.length,
      { timeout: 10000 }
    ).toBe(2);

    expect(mockServer.requests.length).toBe(2);

    const req1 = mockServer.requests[0];
    const req2 = mockServer.requests[1];

    expect((req1.headers as Record<string, string>)["x-ophirpay-event"]).toBe("payment.created");
    expect((req2.headers as Record<string, string>)["x-ophirpay-event"]).toBe("payment.created");

    const body2 = req2.body as Record<string, unknown>;
    const receivedSignature = (req2.headers as Record<string, string>)["x-ophirpay-signature"];
    
    const canonical = JSON.stringify({ ...body2, signature: "" });
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(canonical)
      .digest("hex");

    expect(receivedSignature).toBe(expectedSignature);
    expect(body2.signature).toBe(expectedSignature);
  });
});
