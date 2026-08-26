const puppeteer = require("puppeteer");

const pages = [
  { url: "http://localhost:3000", name: "dashboard" },
  { url: "http://localhost:3000/payments", name: "payments" },
  { url: "http://localhost:3000/send", name: "send-payment" },
  { url: "http://localhost:3000/batches", name: "batches" },
  { url: "http://localhost:3000/batches/new", name: "batch-new" },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });

  for (const page of pages) {
    console.log(`Capturing: ${page.url} -> ${page.name}.png`);
    const tab = await browser.newPage();
    await tab.setViewport({ width: 1440, height: 900 });
    try {
      await tab.goto(page.url, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 1000)); // extra render time
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
  console.log("\nAll screenshots captured!");
})();
