/**
 * OphirPay Demo Video Generator v2.0
 *
 * Creates a ~2.5 minute demo video by:
 * 1. Capturing the live Vercel deployment (ophirpay.vercel.app) via Puppeteer
 * 2. Compiling frames into MP4 with FFmpeg
 *
 * Math: 15 slides × 10 frames each = 150 frames @ 1fps = 150s = 2.5 minutes
 */

const puppeteer = require("puppeteer");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const OUTPUT_DIR = path.join(__dirname, "..", "public");
const FRAMES_DIR = path.join(__dirname, "..", ".demo-frames");
const VIDEO_OUTPUT = path.join(OUTPUT_DIR, "demo.mp4");

// Resolve the ffmpeg binary: FFMPEG_PATH env > known static downloads > PATH.
function resolveFfmpeg() {
  const candidates = [
    process.env.FFMPEG_PATH,
    "/tmp/ffmpeg-7.0.2-amd64-static/ffmpeg",
    "/tmp/ffmpeg-6.1.1-amd64-static/ffmpeg",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return "ffmpeg"; // fall back to whatever is on PATH
}

const FFMPEG = resolveFfmpeg();

const BASE_URL = "https://ophirpay.vercel.app";

// Demo slides — capturing the live Vercel deployment
const DEMO_SLIDES = [
  {
    path: "/",
    label: "OphirPay Dashboard",
    description: "Treasury overview with real-time balance, stats, and recent on-chain payments",
  },
  {
    path: "/send",
    label: "Send Payment",
    description: "Send XLM to any Stellar address with memo, asset selection, and instant signing",
  },
  {
    path: "/payments",
    label: "Payment History",
    description: "Searchable, filterable on-chain payment records with status badges",
  },
  {
    path: "/escrows",
    label: "Escrow Management",
    description: "Create, release, and claim time-locked escrow payments with full lifecycle",
  },
  {
    path: "/batches",
    label: "Batch Payments",
    description: "Send to multiple recipients in a single transaction — CSV import supported",
  },
  {
    path: "/recurring",
    label: "Recurring Streams",
    description: "Create and manage Soroban streaming payment contracts",
  },
  {
    path: "/multisig",
    label: "Multisig Approvals",
    description: "Propose, approve, and execute multi-signature treasury payments",
  },
  {
    path: "/governance",
    label: "DAO Governance",
    description: "On-chain proposal creation, voting, and execution with timelock",
  },
  {
    path: "/contracts",
    label: "Smart Contracts",
    description: "Two deployed Soroban contracts on Stellar Testnet with cross-contract invocation",
  },
  {
    path: "/rbac",
    label: "Role-Based Access Control",
    description: "Grant and revoke admin, operator, and auditor roles on-chain",
  },
  {
    path: "/fee-config",
    label: "Fee Configuration",
    description: "Configure payment, escrow, stream, and batch fees with version history",
  },
  {
    path: "/timelock",
    label: "Timelocked Actions",
    description: "Propose admin actions with mandatory delay before execution",
  },
  {
    path: "/events",
    label: "Live Event Streaming",
    description: "SSE real-time payment lifecycle events from the Soroban emitter contract",
  },
  {
    path: "/analytics",
    label: "Analytics Dashboard",
    description: "Gas usage, payment volume, and contract metrics with chart visualizations",
  },
  {
    path: "/",
    label: "Mobile Responsive",
    description: "Full mobile experience — iPhone 375px with hamburger navigation",
    isMobile: true,
  },
];

async function captureFrames() {
  console.log("📸 Capturing demo frames from live Vercel deployment...\n");

  // Clean up and recreate frames dir
  if (fs.existsSync(FRAMES_DIR)) {
    fs.rmSync(FRAMES_DIR, { recursive: true });
  }
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  // Set library path for bundled Chrome dependencies
  const CHROME_LIBS = "/tmp/chrome-libs/usr/lib/x86_64-linux-gnu";
  const CHROME_BIN = "/home/codespace/.cache/puppeteer/chrome/linux-151.0.7922.47/chrome-linux64/chrome";

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_BIN,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    env: {
      ...process.env,
      LD_LIBRARY_PATH: `${CHROME_LIBS}:${process.env.LD_LIBRARY_PATH || ""}`,
    },
  });

  let frameIndex = 0;
  const totalSlides = DEMO_SLIDES.length;

  for (let s = 0; s < totalSlides; s++) {
    const slide = DEMO_SLIDES[s];
    const url = `${BASE_URL}${slide.path}`;
    const isMobile = slide.isMobile || false;

    console.log(`  [${s + 1}/${totalSlides}] ${slide.label}`);

    const tab = await browser.newPage();

    await tab.setViewport({
      width: isMobile ? 375 : 1280,
      height: isMobile ? 812 : 720,
    });

    try {
      await tab.goto(url, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      // Let the page fully render
      await new Promise((r) => setTimeout(r, 2000));

      // Frame 1: clean page (1s)
      await tab.screenshot({
        path: path.join(FRAMES_DIR, `frame_${String(frameIndex).padStart(4, "0")}.png`),
      });
      frameIndex++;

      // Frames 2-5: overlay fades in
      for (let i = 0; i < 4; i++) {
        const opacity = (i + 1) * 0.25;
        await tab.evaluate((label, desc, op) => {
          const existing = document.getElementById("__demo_overlay");
          if (existing) existing.remove();
          const overlay = document.createElement("div");
          overlay.id = "__demo_overlay";
          overlay.innerHTML = `
            <div style="
              position:fixed; bottom:32px; left:24px; right:24px;
              background:linear-gradient(135deg, rgba(99,102,241,${op * 0.92}) 0%, rgba(139,92,246,${op * 0.92}) 100%);
              color:white; padding:20px 28px; border-radius:16px;
              z-index:9999; font-family:system-ui,-apple-system,sans-serif;
              backdrop-filter:blur(12px);
              box-shadow:0 8px 32px rgba(99,102,241,${op * 0.3});
              border:1px solid rgba(255,255,255,${op * 0.15});
            ">
              <div style="font-size:22px;font-weight:700;margin-bottom:6px;letter-spacing:-0.3px">${label}</div>
              <div style="font-size:14px;opacity:0.85;line-height:1.5">${desc}</div>
            </div>`;
          document.body.appendChild(overlay);
        }, slide.label, slide.description, opacity);

        await tab.screenshot({
          path: path.join(FRAMES_DIR, `frame_${String(frameIndex).padStart(4, "0")}.png`),
        });
        frameIndex++;
      }

      // Frames 6-10: hold with full overlay
      for (let i = 0; i < 5; i++) {
        await tab.screenshot({
          path: path.join(FRAMES_DIR, `frame_${String(frameIndex).padStart(4, "0")}.png`),
        });
        frameIndex++;
      }

      console.log(`       ✅ ${slide.label}`);
    } catch (err) {
      console.log(`       ⚠️  ${err.message} — skipping`);
    }

    await tab.close();
  }

  await browser.close();
  console.log(`\n  ✅ ${frameIndex} frames captured across ${totalSlides} slides`);
}

function compileVideo() {
  console.log("\n🎬 Compiling video with FFmpeg...");

  const framesPattern = path.join(FRAMES_DIR, "frame_%04d.png");

  execSync(
    `${FFMPEG} -y -framerate 1 -i ${framesPattern} ` +
      `-c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 ` +
      `-vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" ` +
      `-r 30 -preset ultrafast -movflags +faststart ${VIDEO_OUTPUT}`,
    { stdio: "inherit" }
  );

  // Verify output
  if (!fs.existsSync(VIDEO_OUTPUT)) {
    console.error("  ❌ Video file not created!");
    process.exit(1);
  }

  const stats = fs.statSync(VIDEO_OUTPUT);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  console.log(`  ✅ Video created: ${sizeMB}MB`);
  console.log(`  📁 ${VIDEO_OUTPUT}`);
}

async function main() {
  console.log("🎥 OphirPay Demo Video Generator v2.0\n");
  console.log(`   Source: ${BASE_URL}\n`);

  await captureFrames();
  compileVideo();

  console.log("\n✅ Demo video complete!");
  console.log("   Push to main to auto-deploy to Vercel.");
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
