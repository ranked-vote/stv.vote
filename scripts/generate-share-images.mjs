import puppeteer from "puppeteer";
import fs from "fs/promises";
import path from "path";
import { stat } from "fs/promises";
import { spawn, execSync } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";

const execAsync = promisify(exec);

let detectedPort = 3000;
let devServerProcess = null;

// Logging utilities
const logLevels = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let currentLogLevel = logLevels.INFO;

function log(level, message, data = null) {
  if (level < currentLogLevel) return;

  const prefix =
    {
      [logLevels.DEBUG]: "🔍",
      [logLevels.INFO]: "ℹ️",
      [logLevels.WARN]: "⚠️",
      [logLevels.ERROR]: "❌",
    }[level] || "ℹ️";

  const timestamp = new Date().toISOString().split("T")[1].slice(0, -1);
  if (data) {
    console.log(`${prefix} [${timestamp}] ${message}`, data);
  } else {
    console.log(`${prefix} [${timestamp}] ${message}`);
  }
}

function logProgress(current, total, prefix = "Processing") {
  const percent = ((current / total) * 100).toFixed(1);
  const barLength = 30;
  const filled = Math.floor((current / total) * barLength);
  const bar = "█".repeat(filled) + "░".repeat(barLength - filled);
  process.stdout.write(
    `\r${prefix}: [${bar}] ${current}/${total} (${percent}%)`,
  );
  if (current === total) {
    process.stdout.write("\n");
  }
}

// Optimize PNG using oxipng if available, otherwise skip silently
async function optimizePng(filePath) {
  try {
    // Get file size before optimization
    const statsBefore = await stat(filePath);
    const sizeBefore = statsBefore.size;

    // Run oxipng with maximum optimization to match trunk's expectations
    // --strip safe: remove safe-to-remove metadata
    const result = await execAsync(`oxipng --strip safe "${filePath}"`);
    
    // Log oxipng output if it contains useful information
    if (result.stdout && result.stdout.trim()) {
      log(logLevels.DEBUG, `oxipng: ${result.stdout.trim()}`);
    }
    if (result.stderr && result.stderr.trim()) {
      log(logLevels.DEBUG, `oxipng stderr: ${result.stderr.trim()}`);
    }

    // Get file size after optimization
    const statsAfter = await stat(filePath);
    const sizeAfter = statsAfter.size;
    const saved = sizeBefore - sizeAfter;
    const percentSaved = ((saved / sizeBefore) * 100).toFixed(1);

    if (saved > 0) {
      log(
        logLevels.DEBUG,
        `Optimized ${path.basename(filePath)}: ${(sizeBefore / 1024).toFixed(1)}KB → ${(sizeAfter / 1024).toFixed(1)}KB (${percentSaved}% saved)`,
      );
    }

    return { saved, sizeBefore, sizeAfter };
  } catch (error) {
    // Log but don't fail - optimization is optional
    log(
      logLevels.WARN,
      `PNG optimization failed for ${path.basename(filePath)}: ${error.message}`,
    );
    return { saved: 0, sizeBefore: 0, sizeAfter: 0 };
  }
}

// Optimize multiple PNG files in batch
async function optimizePngBatch(filePaths, concurrency = 10) {
  // Check if oxipng is available
  try {
    execSync("oxipng --version", { encoding: "utf8", stdio: "ignore" });
  } catch {
    log(
      logLevels.WARN,
      "oxipng not found, skipping batch optimization",
    );
    return { totalSaved: 0, totalSizeBefore: 0, totalSizeAfter: 0, count: 0, optimized: 0 };
  }

  if (filePaths.length === 0) {
    return { totalSaved: 0, totalSizeBefore: 0, totalSizeAfter: 0, count: 0, optimized: 0 };
  }

  log(logLevels.INFO, `Optimizing ${filePaths.length} PNG files...`);
  const optimizeStartTime = Date.now();
  let totalSaved = 0;
  let totalSizeBefore = 0;
  let totalSizeAfter = 0;
  let optimized = 0;

  // Process in batches with concurrency limit
  for (let i = 0; i < filePaths.length; i += concurrency) {
    const batch = filePaths.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((filePath) => optimizePng(filePath)),
    );

    for (const result of batchResults) {
      if (result) {
        totalSaved += result.saved;
        totalSizeBefore += result.sizeBefore;
        totalSizeAfter += result.sizeAfter;
        if (result.saved > 0) {
          optimized++;
        }
      }
    }

    logProgress(
      Math.min(i + batch.length, filePaths.length),
      filePaths.length,
      "Optimizing images",
    );
  }

  const optimizeTime = Date.now() - optimizeStartTime;
  const totalPercentSaved =
    totalSizeBefore > 0
      ? ((totalSaved / totalSizeBefore) * 100).toFixed(1)
      : "0.0";

  log(logLevels.INFO, "\n" + "=".repeat(60));
  log(logLevels.INFO, "Optimization Summary");
  log(logLevels.INFO, "=".repeat(60));
  log(
    logLevels.INFO,
    `✅ Optimized: ${optimized}/${filePaths.length} files`,
  );
  log(
    logLevels.INFO,
    `💾 Total size saved: ${(totalSaved / 1024).toFixed(1)}KB (${totalPercentSaved}%)`,
  );
  log(
    logLevels.INFO,
    `📦 Total size: ${(totalSizeBefore / 1024).toFixed(1)}KB → ${(totalSizeAfter / 1024).toFixed(1)}KB`,
  );
  log(
    logLevels.INFO,
    `⏱️  Optimization time: ${(optimizeTime / 1000).toFixed(2)}s`,
  );

  return {
    totalSaved,
    totalSizeBefore,
    totalSizeAfter,
    count: filePaths.length,
    optimized,
  };
}

// Simple page setup helper
async function setupPage(page) {
  await page.setDefaultTimeout(10000);
  await page.setViewport({
    width: 1200,
    height: 630,
    deviceScaleFactor: 1,
  });

  // Force light mode - never use dark mode for card images
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "light" },
  ]);

  // Optimize page loading - block unnecessary resources
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const resourceType = req.resourceType();
    const url = req.url();

    if (
      resourceType === "image" ||
      resourceType === "font" ||
      resourceType === "media" ||
      url.includes("stats.paulbutler.org") ||
      url.includes("analytics") ||
      url.includes("tracking")
    ) {
      req.abort();
    } else {
      req.continue();
    }
  });
}

// Process reports in parallel with concurrency limit
async function processBatch(
  reports,
  browser,
  concurrency = 5,
  onProgress = null,
) {
  const results = [];
  const total = reports.length;
  let processed = 0;

  for (let i = 0; i < reports.length; i += concurrency) {
    const batch = reports.slice(i, i + concurrency);
    const batchStartTime = Date.now();

    log(
      logLevels.DEBUG,
      `Starting batch ${Math.floor(i / concurrency) + 1} (${batch.length} reports)`,
    );

    const batchResults = await Promise.all(
      batch.map(async (report) => {
        const result = await processReport(report, browser);
        processed++;
        if (onProgress) {
          onProgress(processed, total);
        }
        return result;
      }),
    );

    const batchTime = Date.now() - batchStartTime;
    const batchSuccess = batchResults.filter(
      (r) => r.success && !r.skipped,
    ).length;
    const batchSkipped = batchResults.filter(
      (r) => r.success && r.skipped,
    ).length;
    const batchFailed = batchResults.filter((r) => !r.success).length;

    log(
      logLevels.DEBUG,
      `Batch complete: ${batchSuccess} generated, ${batchSkipped} skipped, ${batchFailed} failed (${batchTime}ms)`,
    );

    results.push(...batchResults);
  }

  return results;
}

async function processReport(report, browser, retries = 1) {
  const reportPath = report.path;
  const outputPath = `static/share/${reportPath}.png`;
  const outputDir = path.dirname(outputPath);
  const reportStartTime = Date.now();

  try {
    // Check if image already exists
    try {
      await stat(outputPath);
      // For SQLite-based reports, we can't easily compare timestamps
      // So we regenerate if --force is set or skip if image exists
      if (!process.env.FORCE_REGENERATE) {
        return {
          success: true,
          skipped: true,
          path: reportPath,
          time: Date.now() - reportStartTime,
        };
      }
    } catch {
      // File doesn't exist, proceed with generation
    }

    await fs.mkdir(outputDir, { recursive: true });

    const page = await browser.newPage();
    try {
      await setupPage(page);

      const url = `http://localhost:${detectedPort}/card/${reportPath}`;
      const loadStartTime = Date.now();

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });

      await page.waitForSelector(".card", { timeout: 10000 });

      // Wait for page to be ready
      await page.waitForFunction(
        () => {
          const card = document.querySelector(".card");
          if (!card) return false;

          const header = card.querySelector(".electionHeader");
          if (!header || !header.textContent?.trim()) return false;

          const svgs = card.querySelectorAll("svg");
          if (svgs.length === 0) {
            return true;
          }

          return Array.from(svgs).every((svg) => {
            return (
              svg.children.length > 0 ||
              (svg.getAttribute("width") && svg.getAttribute("height")) ||
              svg.innerHTML.trim().length > 0
            );
          });
        },
        { timeout: 10000 },
      );

      await new Promise((resolve) => setTimeout(resolve, 200));

      const element = await page.$(".card");
      if (!element) {
        throw new Error("Card element not found");
      }

      await element.screenshot({
        path: outputPath,
        type: "png",
        omitBackground: false,
      });

      const totalTime = Date.now() - reportStartTime;
      const loadTime = Date.now() - loadStartTime;

      return {
        success: true,
        skipped: false,
        path: reportPath,
        time: totalTime,
        loadTime,
      };
    } catch (error) {
      if (retries > 0) {
        await page.close();
        await new Promise((resolve) => setTimeout(resolve, 500));
        return processReport(report, browser, retries - 1);
      }
      throw error;
    } finally {
      await page.close();
    }
  } catch (error) {
    return {
      success: false,
      skipped: false,
      path: reportPath,
      error: error.message,
      time: Date.now() - reportStartTime,
    };
  }
}

// Get reports from API
async function getReportsFromAPI() {
  try {
    const response = await fetch(
      `http://localhost:${detectedPort}/api/reports.json`,
    );
    if (!response.ok) {
      log(logLevels.ERROR, `Failed to fetch reports: ${response.status}`);
      return [];
    }

    const index = await response.json();
    const reports = [];

    for (const election of index.elections || []) {
      for (const contest of election.contests || []) {
        reports.push({
          path: `${election.path}/${contest.office}`,
          election: {
            path: election.path,
            jurisdictionName: election.jurisdictionName,
            electionName: election.electionName,
          },
          contest: {
            office: contest.office,
            officeName: contest.officeName,
            numCandidates: contest.numCandidates,
            numRounds: contest.numRounds,
            seats: contest.seats,
          },
        });
      }
    }

    return reports;
  } catch (error) {
    log(logLevels.ERROR, `Error fetching reports: ${error.message}`);
    return [];
  }
}

// Generate homepage share image
async function generateHomepageImage(browser) {
  const outputPath = "static/share/homepage.png";
  const startTime = Date.now();

  try {
    // Check if image already exists (unless forcing regeneration)
    if (!process.env.FORCE_REGENERATE) {
      try {
        await stat(outputPath);
        log(
          logLevels.INFO,
          "Homepage image already exists, skipping (use FORCE_REGENERATE=1 to regenerate)",
        );
        return { success: true, skipped: true };
      } catch {
        // File doesn't exist, proceed
      }
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const page = await browser.newPage();
    try {
      await setupPage(page);

      const url = `http://localhost:${detectedPort}/card/homepage`;
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });

      await page.waitForSelector(".card", { timeout: 10000 });
      await new Promise((resolve) => setTimeout(resolve, 300));

      const element = await page.$(".card");
      if (!element) {
        throw new Error("Card element not found");
      }

      await element.screenshot({
        path: outputPath,
        type: "png",
        omitBackground: false,
      });

      const totalTime = Date.now() - startTime;
      log(logLevels.INFO, `✅ Homepage image generated in ${totalTime}ms`);

      return { success: true, skipped: false, time: totalTime };
    } finally {
      await page.close();
    }
  } catch (error) {
    log(logLevels.ERROR, `Failed to generate homepage image: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function generateShareImages() {
  const scriptStartTime = Date.now();
  log(logLevels.INFO, "Starting share image generation");

  // Set log level from environment
  if (process.env.DEBUG === "1" || process.env.DEBUG === "true") {
    currentLogLevel = logLevels.DEBUG;
  }

  const chromePath =
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  log(logLevels.INFO, `Using Chrome executable: ${chromePath}`);

  let browser;

  try {
    const browserStartTime = Date.now();
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=TranslateUI",
        "--disable-ipc-flooding-protection",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
      ],
      executablePath: chromePath,
    });

    const browserInitTime = Date.now() - browserStartTime;
    log(logLevels.DEBUG, `Browser launched in ${browserInitTime}ms`);

    // Generate homepage image first
    log(logLevels.INFO, "Generating homepage share image...");
    await generateHomepageImage(browser);

    // Get reports from API
    const indexStartTime = Date.now();
    const allReports = await getReportsFromAPI();
    const indexLoadTime = Date.now() - indexStartTime;
    log(logLevels.DEBUG, `Reports loaded in ${indexLoadTime}ms`);

    // Filter out empty reports (no candidates or no rounds means nothing to display)
    const reports = [];
    const skippedEmpty = [];

    for (const report of allReports) {
      if (
        report.contest.numCandidates === 0 ||
        report.contest.numRounds === 0
      ) {
        skippedEmpty.push(report.path);
        continue;
      }
      reports.push(report);
    }

    if (skippedEmpty.length > 0) {
      log(logLevels.INFO, `Skipped ${skippedEmpty.length} empty reports`);
    }
    log(logLevels.INFO, `Found ${reports.length} reports to process`);

    if (reports.length === 0) {
      log(
        logLevels.WARN,
        "No reports found in database. Run 'bun scripts/load-cambridge.ts' first.",
      );
      return;
    }

    // Determine concurrency
    const concurrency = parseInt(process.env.CONCURRENCY || "5", 10);

    log(logLevels.INFO, `Configuration: concurrency=${concurrency}`);

    // Process with progress tracking
    const results = await processBatch(
      reports,
      browser,
      concurrency,
      (current, total) => {
        logProgress(current, total, "Generating images");
      },
    );

    // Collect all generated image paths for batch optimization
    const generatedImages = results
      .filter((r) => r.success && !r.skipped)
      .map((r) => `static/share/${r.path}.png`);
    
    // Also include homepage if it was generated
    try {
      await stat("static/share/homepage.png");
      generatedImages.push("static/share/homepage.png");
    } catch {
      // Homepage not generated, skip
    }

    // Optimize all generated images in batch
    if (generatedImages.length > 0) {
      await optimizePngBatch(generatedImages, concurrency);
    }

    const scriptTotalTime = Date.now() - scriptStartTime;
    const successCount = results.filter((r) => r.success && !r.skipped).length;
    const skippedCount = results.filter((r) => r.success && r.skipped).length;
    const failureCount = results.filter((r) => !r.success).length;

    // Summary output
    log(logLevels.INFO, "\n" + "=".repeat(60));
    log(logLevels.INFO, "Generation Summary");
    log(logLevels.INFO, "=".repeat(60));
    log(logLevels.INFO, `✅ Generated: ${successCount}`);
    log(logLevels.INFO, `⏭️  Skipped (up to date): ${skippedCount}`);
    if (failureCount > 0) {
      log(logLevels.WARN, `❌ Failed: ${failureCount}`);
    }
    log(
      logLevels.INFO,
      `⏱️  Total time: ${(scriptTotalTime / 1000).toFixed(2)}s`,
    );

    // Calculate timing statistics
    const processedResults = results.filter((r) => r.success && !r.skipped);
    if (processedResults.length > 0) {
      const times = processedResults.map((r) => r.time);
      const loadTimes = processedResults.map((r) => r.loadTime || 0);

      const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;
      const avgLoadTime =
        loadTimes.reduce((sum, t) => sum + t, 0) / loadTimes.length;
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      const p50Time = times.sort((a, b) => a - b)[
        Math.floor(times.length * 0.5)
      ];
      const p95Time = times.sort((a, b) => a - b)[
        Math.floor(times.length * 0.95)
      ];

      log(logLevels.INFO, "\nTiming Statistics:");
      log(logLevels.INFO, `  Average load time: ${avgLoadTime.toFixed(1)}ms`);
      log(logLevels.INFO, `  Average total time: ${avgTime.toFixed(1)}ms`);
      log(logLevels.INFO, `  Min/Max: ${minTime}ms / ${maxTime}ms`);
      log(logLevels.INFO, `  P50/P95: ${p50Time}ms / ${p95Time}ms`);
      log(
        logLevels.INFO,
        `  Throughput: ${((processedResults.length / scriptTotalTime) * 1000).toFixed(2)} reports/second`,
      );
    }

    if (failureCount > 0) {
      log(logLevels.ERROR, "\nFailed Reports:");
      results
        .filter((r) => !r.success)
        .forEach((r) => {
          log(logLevels.ERROR, `  ${r.path}: ${r.error}`);
        });
    }
  } catch (error) {
    log(logLevels.ERROR, "Fatal error during image generation", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();
        log(logLevels.DEBUG, "Browser closed");
      } catch (error) {
        log(logLevels.ERROR, "Error closing browser", {
          error: error.message,
        });
      }
    }
  }
}

// Check if dev server is running and detect which port
async function checkDevServer() {
  const ports = [3000, 5173, 3001];

  for (const port of ports) {
    try {
      const response = await fetch(`http://localhost:${port}`);
      if (response.ok) {
        log(logLevels.INFO, `Dev server detected on port ${port}`);
        detectedPort = port;
        return { running: true, port };
      }
    } catch {
      continue;
    }
  }

  return { running: false };
}

// Start dev server and wait for it to be ready
async function startDevServer() {
  log(logLevels.INFO, "Starting dev server...");

  const env = {
    ...process.env,
  };

  // Use spawn without shell to avoid security warning
  devServerProcess = spawn("bun", ["run", "dev"], {
    env,
    stdio: "ignore",
    shell: false,
  });

  devServerProcess.on("error", (error) => {
    log(logLevels.ERROR, "Failed to start dev server", {
      error: error.message,
    });
  });

  // Wait for server to be ready
  const ports = [3000, 5173, 3001];
  const maxAttempts = 30;
  const checkInterval = 1000;

  log(logLevels.DEBUG, `Waiting for dev server (max ${maxAttempts}s)...`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, checkInterval));

    for (const port of ports) {
      try {
        const response = await fetch(`http://localhost:${port}`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) {
          log(logLevels.INFO, `✅ Dev server ready on port ${port}`);
          detectedPort = port;
          return;
        }
      } catch {
        continue;
      }
    }

    if (attempt % 5 === 4) {
      log(logLevels.DEBUG, `Still waiting... (${attempt + 1}/${maxAttempts})`);
    }
  }

  throw new Error(`Dev server failed to start after ${maxAttempts} seconds`);
}

// Stop dev server
function stopDevServer() {
  if (devServerProcess) {
    log(logLevels.INFO, "Stopping dev server...");
    devServerProcess.kill();
    devServerProcess = null;
  }
}

// Cleanup on exit
process.on("SIGINT", () => {
  stopDevServer();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopDevServer();
  process.exit(0);
});

// Run the script
(async () => {
  let serverWasRunning = false;
  const args = process.argv.slice(2);
  const homepageOnly = args.includes("--homepage") || args.includes("-h");

  try {
    // Check if server is already running
    const serverStatus = await checkDevServer();

    if (!serverStatus.running) {
      // Start server if not running
      await startDevServer();
    } else {
      serverWasRunning = true;
      log(logLevels.INFO, "Using existing dev server");
    }

    if (homepageOnly) {
      // Generate only homepage image
      log(logLevels.INFO, "Generating homepage image only...");
      const chromePath =
        process.env.CHROME_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

      const browser = await puppeteer.launch({
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
        executablePath: chromePath,
      });

      try {
        process.env.FORCE_REGENERATE = "1"; // Always regenerate when using --homepage
        await generateHomepageImage(browser);
        // Optimize homepage image
        try {
          await stat("static/share/homepage.png");
          await optimizePngBatch(["static/share/homepage.png"], 1);
        } catch {
          // Homepage not generated, skip
        }
      } finally {
        await browser.close();
      }
    } else {
      // Generate all images
      await generateShareImages();
    }

    // Count generated images
    try {
      const imageCount = execSync(
        'find static/share -name "*.png" 2>/dev/null | wc -l',
        { encoding: "utf8" },
      ).trim();
      log(
        logLevels.INFO,
        `\n📊 Total share images in static/share: ${imageCount}`,
      );
    } catch {
      // Ignore if find fails
    }
  } catch (error) {
    log(logLevels.ERROR, "Fatal error in main execution", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  } finally {
    // Only stop server if we started it
    if (!serverWasRunning) {
      stopDevServer();
    }
  }
})();
