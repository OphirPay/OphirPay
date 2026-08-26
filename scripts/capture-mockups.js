const puppeteer = require("puppeteer");
const path = require("path");

const pages = [
  { file: "dashboard.html", name: "dashboard" },
  { file: "wallet-options.html", name: "wallet-options" },
  { file: "send-form.html", name: "send-payment" },
  { file: "tx-success.html", name: "transaction-success" },
  { file: "payments-list.html", name: "payments" },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });

  for (const page of pages) {
    const filePath = `file://${path.resolve(__dirname, "mockups", page.file)}`;
    console.log(`Capturing: ${page.file} -> ${page.name}.png`);
    const tab = await browser.newPage();
    await tab.setViewport({ width: 1440, height: 900 });
    try {
      await tab.goto(filePath, { waitUntil: "networkidle0", timeout: 15000 });
      await tab.screenshot({
        path: `public/screenshots/${page.name}.png`,
        fullPage: false,
      });
      console.log(`  ✅ Saved ${page.name}.png`);
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
    }
    await tab.close();
  }

  await browser.close();
  console.log("\nDone!");
})();
