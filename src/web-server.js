"use strict";

console.log("[STARTUP] web-server.js loading...");
console.log("[STARTUP] PORT =", process.env.PORT);
console.log("[STARTUP] NODE_ENV =", process.env.NODE_ENV);
console.log("[STARTUP] cwd =", process.cwd());

const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { writeVbkconFile } = require("./vbkcon");
const { writeBulkStatusFile } = require("./bulk-status");
const { writeCarrierShipmentFile } = require("./carrier-shipment");
const { writeAsnFcbkcFile } = require("./asn-fcbkc");
const { writeAsnRcvFile } = require("./asn-rcv");
const { writeAsnPadexFile } = require("./asn-padex");
const { writeAsnFeedFile } = require("./asn-feed");
const { writeGpmFile } = require("./gpm");
const { writePoFeedFile } = require("./po-feed");
const { uploadFileToSftp } = require("./sftp");
const { buildSftpConfigFromEnv } = require("./sftp-config");
const { searchBlobsByAsn, downloadBlobs } = require("./blob-search");
const {
  getAbvCounterFile,
  getCarrierSequenceFile,
  getOutputDir,
  getStateDir,
  loadEnvironment,
} = require("./app-config");

loadEnvironment();

// Ensure required directories exist (they are gitignored so won't be present on Azure)
[getOutputDir(process.env), getStateDir(process.env)].forEach((dir) => {
  console.log("[STARTUP] Ensuring dir:", dir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Health check endpoint (useful for Azure probes)
app.get("/api/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), pid: process.pid });
});

const PORT = process.env.PORT || 3000;

async function upload(filePath) {
  const sftpConfig = buildSftpConfigFromEnv(process.env);
  const result = await uploadFileToSftp({
    localFilePath: filePath,
    remoteDir: sftpConfig.remoteDir,
    connectionOptions: sftpConfig.connectionOptions,
  });
  return result.remotePath;
}

function validate(body, fields) {
  const missing = fields.filter((f) => !body[f] || !String(body[f]).trim());
  return missing.length ? `Missing required fields: ${missing.join(", ")}` : null;
}

// ── Live progress log ─────────────────────────────────────────────────────────

let progressLog = [];

function clearProgress() {
  progressLog = [];
}

function addProgress(message) {
  const entry = { ts: new Date().toLocaleTimeString(), message };
  progressLog.push(entry);
  console.log(`[PROGRESS] ${entry.ts} — ${message}`);
}

// Keywords to pick up from Playwright stdout/stderr as progress updates
const PROGRESS_PATTERNS = [
  // Explicit progress marker (tests can use: console.log("PROGRESS: message"))
  { re: /PROGRESS:\s*(.+)/i, extract: (m) => m[1].trim() },

  // Actual prefixes used by Playwright specs
  { re: /\[asn-lookup\]\s*(.+)/i, extract: (m) => m[1].trim() },
  { re: /\[booking-step\]\s*(.+)/i, extract: (m) => m[1].trim() },
  { re: /\[full-flow\]\s*(.+)/i, extract: (m) => m[1].trim() },

  // Key data markers from specs
  { re: /ASN_LOOKUP_RESULTS?:\s*(.+)/i, extract: (m) => "ASN lookup complete" },
  { re: /FULL_FLOW_RESULT:\s*/i, extract: () => "Full flow result received" },
  { re: /VB Reference:\s*(VB-\S+)/i, extract: (m) => `VB Reference: ${m[1]}` },
  { re: /Booking Status:\s*(\w+)/i, extract: (m) => `Booking status: ${m[1]}` },
  { re: /Booking completed for ASN:\s*(.+)/i, extract: (m) => `Booking completed for ASN: ${m[1].trim()}` },
  { re: /Multi-ASN booking completed/i, extract: () => "Multi-ASN booking completed" },
  { re: /Step\s*(\d+)/i, extract: (m) => `Step ${m[1]} in progress…` },

  // Common Playwright / browser actions
  { re: /navigating to|goto\(|page\.goto/i, extract: () => "Navigating to portal…" },
  { re: /logging in|login|signed in|authenticated|credentials/i, extract: () => "Logging in to SCC…" },
  { re: /searching|order search|search.*page/i, extract: () => "Searching records…" },
  { re: /found (\d+) record/i, extract: (m) => `Found ${m[1]} record(s)` },
  { re: /creating.*booking|create.*booking|new booking/i, extract: () => "Creating new booking…" },
  { re: /draft.*created|booking.*draft/i, extract: () => "Draft VB created" },
  { re: /editing|edit.*booking/i, extract: () => "Editing VB details…" },
  { re: /adding.*asn|asn.*added/i, extract: () => "Adding ASN to booking…" },
  { re: /submitting|submit.*booking/i, extract: () => "Submitting VB…" },
  { re: /approv/i, extract: () => "Processing approval…" },
  { re: /approved/i, extract: () => "VB approved ✓" },

  // Playwright test runner output
  { re: /(\d+) passed/i, extract: (m) => `${m[1]} test(s) passed ✓` },
  { re: /(\d+) failed/i, extract: (m) => `${m[1]} test(s) failed ✕` },
  { re: /timed?\s*out/i, extract: () => "Operation timed out" },
];

// Noise lines to skip (Playwright runner boilerplate)
const NOISE_PATTERNS = [
  /^\s*$/,
  /^Running \d+ test/i,
  /^npx playwright/i,
  /^Using.*config/i,
  /^\s*at\s+/,           // stack traces
  /^node_modules/,
  /^\d+\s*\|/,           // source code lines in error output
  /^=+$/,                // separator lines
];

function parseStdoutForProgress(data) {
  const text = data.toString();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Skip noise
    if (NOISE_PATTERNS.some((p) => p.test(line))) continue;

    let matched = false;
    for (const pat of PROGRESS_PATTERNS) {
      const m = line.match(pat.re);
      if (m) {
        const msg = pat.extract(m);
        // Avoid duplicate consecutive messages
        if (progressLog.length === 0 || progressLog[progressLog.length - 1].message !== msg) {
          addProgress(msg);
        }
        matched = true;
        break;
      }
    }

    // If no pattern matched but line contains a console.log from the spec, show it raw
    if (!matched && line.length > 5 && line.length < 200) {
      // Only show lines that look like intentional log output (contains letters, not just symbols)
      if (/[a-zA-Z]{3,}/.test(line) && !/^[\s\d.:]+$/.test(line)) {
        const msg = line.substring(0, 150);
        if (progressLog.length === 0 || progressLog[progressLog.length - 1].message !== msg) {
          addProgress(msg);
        }
      }
    }
  }
}

app.get("/api/progress", (req, res) => {
  const since = parseInt(req.query.since, 10) || 0;
  const entries = progressLog.slice(since);
  res.json({ entries, total: progressLog.length });
});

// ── Individual endpoints ──────────────────────────────────────────────────────

app.post("/api/generate/vbkcon", async (req, res) => {
  const err = validate(req.body, ["ace"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { ace, carrier = "DT" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeVbkconFile({
      ace,
      carrier,
      outputDir,
      abvCounterFile: getAbvCounterFile(process.env),
    });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/bst", async (req, res) => {
  const err = validate(req.body, ["asn"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeBulkStatusFile({ asn, outputDir });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/shipment", async (req, res) => {
  const err = validate(req.body, ["asn", "po", "sku"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn, po, sku, skuQty = "1", carrier = "DT" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeCarrierShipmentFile({
      asn,
      po,
      sku,
      skuQty,
      carrier,
      outputDir,
      sequenceFile: getCarrierSequenceFile(process.env),
    });
    const remotePath = await upload(gen.filePath);
    res.json({
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath,
      sequence: gen.sequence,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/asn-fcbkc", async (req, res) => {
  const err = validate(req.body, ["asn"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeAsnFcbkcFile({ asn, outputDir });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/asn-rcv", async (req, res) => {
  const err = validate(req.body, ["asn"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeAsnRcvFile({ asn, outputDir });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/asn-padex", async (req, res) => {
  const err = validate(req.body, ["asn", "po", "sku"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn, po, sku, skuQty = "1" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeAsnPadexFile({ asn, po, sku, skuQty, outputDir });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/asn-feed", async (req, res) => {
  const err = validate(req.body, ["asn", "po", "sku"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn, po, sku, skuQty = "1" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeAsnFeedFile({ asn, po, sku, skuQty, outputDir });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/gpm", async (req, res) => {
  const err = validate(req.body, ["sku", "optionId"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { sku, optionId } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeGpmFile({ sku, optionId, outputDir });

    // Multiple SKUs → multiple files
    if (gen.files) {
      const uploaded = [];
      for (const f of gen.files) {
        const remotePath = await upload(f.filePath);
        uploaded.push({ fileName: f.fileName, sku: f.sku, uploaded: true, remotePath });
      }
      return res.json({ ok: true, files: uploaded });
    }

    // Single SKU
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/po-feed", async (req, res) => {
  const err = validate(req.body, ["po", "sku", "optionId"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { po, sku, skuQty = "1", optionId, carrier = "DT" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writePoFeedFile({ po, sku, skuQty, optionId, carrier, outputDir });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Generate All (order: VBKCON → BST → Shipment → FCBKC → RCV → PADEX → ASN Feed) ─────

app.post("/api/generate/all", async (req, res) => {
  const err = validate(req.body, ["asn", "po", "sku", "ace"]);
  if (err) return res.status(400).json({ ok: false, error: err });

  const { asn, po, sku, skuQty = "1", ace, carrier = "DT" } = req.body;
  const outputDir = getOutputDir(process.env);
  const results = {};

  // 1. VBKCON
  try {
    const gen = await writeVbkconFile({
      ace,
      carrier,
      outputDir,
      abvCounterFile: getAbvCounterFile(process.env),
    });
    results.vbkcon = {
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath: await upload(gen.filePath),
    };
  } catch (e) {
    results.vbkcon = { ok: false, error: e.message };
  }

  // 2. BST
  try {
    const gen = await writeBulkStatusFile({ asn, outputDir });
    results.bst = {
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath: await upload(gen.filePath),
    };
  } catch (e) {
    results.bst = { ok: false, error: e.message };
  }

  // 3. Carrier Shipment
  try {
    const gen = await writeCarrierShipmentFile({
      asn,
      po,
      sku,
      skuQty,
      carrier,
      outputDir,
      sequenceFile: getCarrierSequenceFile(process.env),
    });
    results.shipment = {
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath: await upload(gen.filePath),
    };
  } catch (e) {
    results.shipment = { ok: false, error: e.message };
  }

  // 4. ASN FCBKC
  try {
    const gen = await writeAsnFcbkcFile({ asn, outputDir });
    results.asnFcbkc = {
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath: await upload(gen.filePath),
    };
  } catch (e) {
    results.asnFcbkc = { ok: false, error: e.message };
  }

  // 5. ASN RCV
  try {
    const gen = await writeAsnRcvFile({ asn, outputDir });
    results.asnRcv = {
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath: await upload(gen.filePath),
    };
  } catch (e) {
    results.asnRcv = { ok: false, error: e.message };
  }

  // 6. ASN PADEX
  try {
    const gen = await writeAsnPadexFile({ asn, po, sku, skuQty, outputDir });
    results.asnPadex = {
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath: await upload(gen.filePath),
    };
  } catch (e) {
    results.asnPadex = { ok: false, error: e.message };
  }

  res.json({ ok: Object.values(results).every((r) => r.ok), results });
});

// ── ASN Lookup in SCC (Playwright) ────────────────────────────────────────────

const PLAYWRIGHT_PROJECT = path.resolve(
  __dirname,
  "..",
  "..",
  "asos-sct-aim-automation-tests",
  "sct-warehouse-E2Open-test-automation"
);

const ASN_LOOKUP_TIMEOUT_MS = Number(process.env.ASN_LOOKUP_TIMEOUT_MS || 180000);

app.post("/api/asn-lookup", async (req, res) => {
  const err = validate(req.body, ["asn"]);
  if (err) return res.status(400).json({ ok: false, error: err });

  const { asn } = req.body;
  const lookupResultsFile = path.join(PLAYWRIGHT_PROJECT, "asn-lookup-results.json");

  clearProgress();
  addProgress(`Starting ASN Lookup for: ${asn}`);

  // Clean up previous results file
  try { fs.unlinkSync(lookupResultsFile); } catch (_) {}

  const args = [
    "playwright",
    "test",
    "tests/ASNLookup.spec.js",
    "--reporter=line",
    "--workers=1",
  ];
  const env = { ...process.env, CI: "true", ASN_LOOKUP_VALUE: asn };

  try {
    const result = await new Promise((resolve) => {
      let child;
      try {
        child = process.platform === "win32"
          ? spawn("cmd.exe", ["/d", "/s", "/c", `npx ${args.join(" ")}`], {
              cwd: PLAYWRIGHT_PROJECT,
              shell: false,
              env,
            })
          : spawn("npx", args, {
              cwd: PLAYWRIGHT_PROJECT,
              shell: false,
              env,
            });
      } catch (spawnErr) {
        return resolve({ ok: false, error: `Failed to start Playwright: ${spawnErr.message}` });
      }
      setActiveChild(child, "ASN Lookup");
      addProgress("Launching browser for ASN Lookup…");

      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        resolve(payload);
      };

      const timeoutHandle = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch (_) {}
        finish({ ok: false, error: `ASN lookup timed out after ${Math.floor(ASN_LOOKUP_TIMEOUT_MS / 1000)}s` });
      }, ASN_LOOKUP_TIMEOUT_MS);

      child.stdout.on("data", (data) => { stdout += data.toString(); parseStdoutForProgress(data); });
      child.stderr.on("data", (data) => { stderr += data.toString(); parseStdoutForProgress(data); });

      child.on("close", (code) => {
        clearTimeout(timeoutHandle);
        addProgress("ASN Lookup completed");
        const merged = `${stdout}\n${stderr}`;

        // Try reading the structured results file first (most reliable)
        let fileResults = null;
        try {
          const raw = fs.readFileSync(lookupResultsFile, "utf-8");
          fileResults = JSON.parse(raw);
        } catch (_) {
          // File may not exist if test failed before writing
        }

        if (fileResults) {
          return finish({ ok: true, ...fileResults, asn });
        }

        // Fallback: Try structured JSON output from stdout
        const jsonMatch = merged.match(/ASN_LOOKUP_RESULTS:\s*(\{.*\})/);
        if (jsonMatch) {
          try {
            const results = JSON.parse(jsonMatch[1]);
            return finish({ ok: true, ...results, asn });
          } catch {
            // Fall through to legacy parsing
          }
        }

        // Legacy single-ASN output
        const resultMatch = merged.match(/ASN_LOOKUP_RESULT:\s*(FOUND|NOT_FOUND)/);
        const found = resultMatch ? resultMatch[1] === "FOUND" : false;

        if (code === 0) {
          finish({ ok: true, found, asn });
        } else {
          // Even if test "failed", check if we got a lookup result
          if (resultMatch) {
            finish({ ok: true, found, asn });
          } else {
            const errorLines = merged.split("\n").filter(
              (l) => /error|fail|timeout|✕/i.test(l)
            );
            finish({
              ok: false,
              error: errorLines.length ? errorLines.slice(0, 5).join("\n") : "Lookup failed (exit code " + code + ")",
            });
          }
        }
      });

      child.on("error", (e) => {
        clearTimeout(timeoutHandle);
        finish({ ok: false, error: `Failed to run Playwright: ${e.message}` });
      });
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Booking Creation (Playwright) ─────────────────────────────────────────────

const BOOKING_TIMEOUT_MS = Number(process.env.BOOKING_TIMEOUT_MS || 600000);

// Booking request queue to prevent concurrent runs (which cause conflicts)
let bookingInProgress = false;
const bookingQueue = [];

// Track active child processes for force-cancel support
let activeChild = null;
let activeLabel = null;

function setActiveChild(child, label) {
  activeChild = child;
  activeLabel = label;
  if (child) {
    child.on("close", () => {
      if (activeChild === child) { activeChild = null; activeLabel = null; }
    });
  }
}

function processBookingQueue() {
  if (bookingInProgress || bookingQueue.length === 0) return;
  bookingInProgress = true;
  const item = bookingQueue.shift();
  if (item.executor) {
    item.executor(item.resolve);
  } else {
    executeBooking(item.asn, item.specFile, item.resolve);
  }
}

async function executeBooking(asn, specFile, resolve) {
  const asnsForFile = asn
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .join(",");
  const asnFilePath = path.join(PLAYWRIGHT_PROJECT, "tests", "asns.txt");
  const resultsFilePath = path.join(PLAYWRIGHT_PROJECT, "booking-results.json");

  clearProgress();
  addProgress(`Starting Booking for ASN(s): ${asnsForFile}`);

  // Clean up any previous results file
  try { fs.unlinkSync(resultsFilePath); } catch (_) {}

  try {
    fs.writeFileSync(asnFilePath, asnsForFile, "utf-8");
  } catch (e) {
    bookingInProgress = false;
    processBookingQueue();
    return resolve({ ok: false, error: `Failed to write ASN file: ${e.message}` });
  }
  addProgress("ASN file written, launching browser…");

  // Spawn Playwright test with optimizations
  const args = [
    "playwright",
    "test",
    `tests/${specFile}`,
    "--reporter=line",
    "--workers=1",
  ];
  const env = { ...process.env, CI: "true", BOOKING_FAST_MODE: process.env.BOOKING_FAST_MODE || "false" };

  let child;
  try {
    child = process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", `npx ${args.join(" ")}`], {
          cwd: PLAYWRIGHT_PROJECT,
          shell: false,
          env,
        })
      : spawn("npx", args, {
          cwd: PLAYWRIGHT_PROJECT,
          shell: false,
          env,
        });
  } catch (spawnErr) {
    bookingInProgress = false;
    processBookingQueue();
    return resolve({ ok: false, error: `Failed to start Playwright: ${spawnErr.message}` });
  }
  setActiveChild(child, "Booking");
  addProgress("Browser launched, running booking test…");

  let stdout = "";
  let stderr = "";
  let settled = false;
  const finish = (payload) => {
    if (settled) return;
    settled = true;
    bookingInProgress = false;
    processBookingQueue();
    resolve(payload);
  };

  const timeoutHandle = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch (_) {
      // Ignore kill errors and return timeout response.
    }
    finish({
      ok: false,
      error: `Booking timed out after ${Math.floor(BOOKING_TIMEOUT_MS / 1000)}s. Please retry.`,
      passed: false,
    });
  }, BOOKING_TIMEOUT_MS);

  child.stdout.on("data", (data) => { stdout += data.toString(); parseStdoutForProgress(data); });
  child.stderr.on("data", (data) => { stderr += data.toString(); parseStdoutForProgress(data); });

  child.on("close", (code) => {
    clearTimeout(timeoutHandle);
    addProgress("Booking process completed");

    // Read structured results from the JSON file written by the spec
    let fileResults = [];
    try {
      const raw = fs.readFileSync(resultsFilePath, "utf-8");
      fileResults = JSON.parse(raw);
    } catch (_) {
      // File may not exist if test failed before writing
    }

    // Extract VB references and statuses from file results
    const vbReferences = fileResults.map((r) => r.vbReference).filter(Boolean);
    const bookingStatuses = fileResults.map((r) => r.bookingStatus).filter(Boolean);

    // Fallback: also parse from stdout/stderr in case file wasn't written
    const merged = `${stdout}\n${stderr}`;
    if (vbReferences.length === 0) {
      const vbMatches = [...merged.matchAll(/VB Reference:\s*(VB-\d+)/gi)];
      vbMatches.forEach((m) => vbReferences.push(m[1]));
    }
    if (bookingStatuses.length === 0) {
      const statusMatches = [...merged.matchAll(/Booking Status:\s*(\w+)/gi)];
      statusMatches.forEach((m) => bookingStatuses.push(m[1]));
    }

    const vbReference = vbReferences.length > 0 ? vbReferences[0] : null;
    const bookingStatus = bookingStatuses.length > 0 ? bookingStatuses[0] : null;

    if (code === 0) {
      finish({
        ok: true,
        vbReference,
        vbReferences,
        bookingStatus,
        bookingStatuses,
        bookingDetails: fileResults,
        passed: true,
      });
    } else {
      const output = merged.trim();
      const errorLines = output.split("\n").filter(
        (l) => /error|fail|timeout|✕/i.test(l)
      );
      finish({
        ok: false,
        error: errorLines.length ? errorLines.slice(0, 5).join("\n") : "Test failed (exit code " + code + ")",
        vbReference,
        vbReferences,
        bookingStatus,
        bookingStatuses,
        bookingDetails: fileResults,
        passed: false,
      });
    }
  });

  child.on("error", (e) => {
    clearTimeout(timeoutHandle);
    finish({ ok: false, error: `Failed to run Playwright: ${e.message}` });
  });
}

// GET endpoint to fetch the latest booking results file
app.get("/api/booking/results", (req, res) => {
  const resultsFilePath = path.join(PLAYWRIGHT_PROJECT, "booking-results.json");
  try {
    const raw = fs.readFileSync(resultsFilePath, "utf-8");
    const results = JSON.parse(raw);
    res.json({ ok: true, bookingDetails: results });
  } catch (e) {
    res.status(404).json({ ok: false, error: "No booking results found" });
  }
});

app.post("/api/booking/create", async (req, res) => {
  const err = validate(req.body, ["asn"]);
  if (err) return res.status(400).json({ ok: false, error: err });

  const { asn } = req.body;

  // Queue the booking request (legacy — uses MultiASNbookingPassed)
  const resultPromise = new Promise((resolve) => {
    bookingQueue.push({ asn, specFile: "MultiASNbookingPassed.spec.js", resolve });
    processBookingQueue();
  });

  const result = await resultPromise;
  res.json(result);
});

// Single ASN × Multiple Bookings — one booking per ASN, login once
app.post("/api/booking/create-single", async (req, res) => {
  req.setTimeout(0); // disable per-request timeout for long-running bookings
  const err = validate(req.body, ["asn"]);
  if (err) return res.status(400).json({ ok: false, error: err });

  const { asn } = req.body;

  const resultPromise = new Promise((resolve) => {
    bookingQueue.push({ asn, specFile: "SingleASNBookingMultipleTimes.spec.js", resolve });
    processBookingQueue();
  });

  const result = await resultPromise;
  res.json(result);
});

// Multi ASN × One Booking — all ASNs in a single booking
app.post("/api/booking/create-multi", async (req, res) => {
  req.setTimeout(0); // disable per-request timeout for long-running bookings
  const err = validate(req.body, ["asn"]);
  if (err) return res.status(400).json({ ok: false, error: err });

  const { asn } = req.body;

  const resultPromise = new Promise((resolve) => {
    bookingQueue.push({ asn, specFile: "MultiASNSingleBooking.spec.js", resolve });
    processBookingQueue();
  });

  const result = await resultPromise;
  res.json(result);
});

// ── Full SCC Flow (ASN Lookup + Single Booking + Approval) ──────────────────

function executeFullFlow(asn, resolve) {
  const resultsFilePath = path.join(PLAYWRIGHT_PROJECT, "full-scc-flow-results.json");
  clearProgress();
  addProgress(`Starting Full SCC Flow for ASN(s): ${asn}`);
  try { fs.unlinkSync(resultsFilePath); } catch (_) {}

  const args = [
    "playwright", "test", "tests/FullSCCFlow.spec.js",
    "--reporter=line", "--workers=1",
  ];
  const env = { ...process.env, CI: "true", FULL_FLOW_ASN_VALUE: asn };

  let child;
  try {
    child = process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", `npx ${args.join(" ")}`], {
          cwd: PLAYWRIGHT_PROJECT, shell: false, env,
        })
      : spawn("npx", args, { cwd: PLAYWRIGHT_PROJECT, shell: false, env });
  } catch (spawnErr) {
    bookingInProgress = false;
    processBookingQueue();
    return resolve({ ok: false, error: `Failed to start Playwright: ${spawnErr.message}` });
  }
  setActiveChild(child, "Full SCC Flow");
  addProgress("Browser launched, running full SCC flow…");

  let stdout = "", stderr = "";
  let settled = false;
  const finish = (payload) => {
    if (settled) return;
    settled = true;
    bookingInProgress = false;
    processBookingQueue();
    resolve(payload);
  };

  const timeoutMs = Number(process.env.FULL_FLOW_TIMEOUT_MS || 600000);
  const timeoutHandle = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch (_) {}
    finish({ ok: false, error: `Full SCC flow timed out after ${Math.floor(timeoutMs / 1000)}s` });
  }, timeoutMs);

  child.stdout.on("data", (d) => { stdout += d.toString(); parseStdoutForProgress(d); });
  child.stderr.on("data", (d) => { stderr += d.toString(); parseStdoutForProgress(d); });

  child.on("close", (code) => {
    clearTimeout(timeoutHandle);
    addProgress("Full SCC Flow completed");
    const merged = `${stdout}\n${stderr}`;

    // Read structured results file
    let fileResults = null;
    try {
      fileResults = JSON.parse(fs.readFileSync(resultsFilePath, "utf-8"));
    } catch (_) {}

    if (fileResults) {
      return finish(fileResults);
    }

    // Fallback: parse from stdout
    const jsonMatch = merged.match(/FULL_FLOW_RESULT:\s*(\{.*\})/);
    if (jsonMatch) {
      try { return finish(JSON.parse(jsonMatch[1])); } catch {}
    }

    if (code === 0) {
      finish({ ok: true, asn, details: [] });
    } else {
      const errorLines = merged.split("\n").filter(
        (l) => /error|fail|timeout|✕/i.test(l)
      );
      finish({
        ok: false,
        error: errorLines.length
          ? errorLines.slice(0, 5).join("\n")
          : "Full flow failed (exit code " + code + ")",
      });
    }
  });

  child.on("error", (e) => {
    clearTimeout(timeoutHandle);
    finish({ ok: false, error: `Failed to run Playwright: ${e.message}` });
  });
}

app.post("/api/full-scc-flow", async (req, res) => {
  req.setTimeout(0);
  const err = validate(req.body, ["asn"]);
  if (err) return res.status(400).json({ ok: false, error: err });

  const { asn } = req.body;

  const resultPromise = new Promise((resolve) => {
    bookingQueue.push({
      resolve,
      executor: (resolveInner) => executeFullFlow(asn, resolveInner),
    });
    processBookingQueue();
  });

  const result = await resultPromise;
  res.json(result);
});

// ── Force Cancel ──────────────────────────────────────────────────────────────

app.post("/api/cancel", (req, res) => {
  if (activeChild) {
    const label = activeLabel || "unknown";
    try { activeChild.kill("SIGKILL"); } catch (_) {}
    activeChild = null;
    activeLabel = null;
    bookingInProgress = false;
    // Drain any queued items so they don't run after cancel
    while (bookingQueue.length) {
      const item = bookingQueue.shift();
      item.resolve({ ok: false, error: "Cancelled by user" });
    }
    res.json({ ok: true, message: `Cancelled: ${label}` });
  } else {
    res.json({ ok: true, message: "Nothing running" });
  }
});

// ── Blob Search & Download ────────────────────────────────────────────────────

app.post("/api/blob-search", async (req, res) => {
  const { asn, hoursBack = 1440, maxBlobs = 1000 } = req.body;
  if (!asn || !asn.trim()) return res.status(400).json({ ok: false, error: "asn is required" });

  const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ ok: false, error: "AZURE_BLOB_CONNECTION_STRING not configured" });
  }

  try {
    const containerName = process.env.AZURE_BLOB_CONTAINER || "sftp-inbound";
    const result = await searchBlobsByAsn({ asn: asn.trim(), connectionString, containerName, hoursBack, maxBlobs });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/blob-download", async (req, res) => {
  const { blobNames } = req.body;
  if (!Array.isArray(blobNames) || blobNames.length === 0) {
    return res.status(400).json({ ok: false, error: "blobNames array is required" });
  }

  const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ ok: false, error: "AZURE_BLOB_CONNECTION_STRING not configured" });
  }

  try {
    const containerName = process.env.AZURE_BLOB_CONTAINER || "sftp-inbound";
    const outputDir = getOutputDir(process.env);
    const result = await downloadBlobs({ blobNames, connectionString, containerName, outputDir });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/blob-file", async (req, res) => {
  const blobName = req.query.name;
  if (!blobName) return res.status(400).json({ ok: false, error: "name query param is required" });

  // Validate blob path stays within expected container prefix
  if (blobName.includes("..") || blobName.startsWith("/")) {
    return res.status(400).json({ ok: false, error: "Invalid blob name" });
  }

  const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ ok: false, error: "AZURE_BLOB_CONNECTION_STRING not configured" });
  }

  try {
    const { BlobServiceClient } = require("@azure/storage-blob");
    const containerName = process.env.AZURE_BLOB_CONTAINER || "sftp-inbound";
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(blobName);

    const downloadResponse = await blobClient.download(0);
    const fileName = blobName.split("/").pop();

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/xml");
    if (downloadResponse.contentLength) {
      res.setHeader("Content-Length", downloadResponse.contentLength);
    }
    downloadResponse.readableStreamBody.pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── ADO Status Email (Preview & Send) ─────────────────────────────────────────

const ADO_REPORT_DIR = process.env.ADO_REPORT_DIR || path.join(
  process.env.USERPROFILE || process.env.HOME || "/home/site",
  "RaiseADOBugs"
);
const ADO_SCRIPT = path.join(ADO_REPORT_DIR, "Run-Report.ps1");

// Expose availability so the UI can disable buttons gracefully
app.get("/api/ado-status", (req, res) => {
  const available = fs.existsSync(ADO_SCRIPT);
  res.json({ available, scriptPath: ADO_SCRIPT });
});

function runAdoReport(previewOnly) {
  return new Promise((resolve) => {
    if (!fs.existsSync(ADO_SCRIPT)) {
      return resolve({ ok: false, error: `Script not found: ${ADO_SCRIPT}` });
    }
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ADO_SCRIPT];
    if (previewOnly) args.push("-PreviewOnly");

    const child = spawn("powershell.exe", args, {
      cwd: ADO_REPORT_DIR, shell: false,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("close", (code) => {
      if (code !== 0) {
        return resolve({ ok: false, error: stderr || stdout || `Exit code ${code}` });
      }
      // Extract report file path from stdout
      const match = stdout.match(/PREVIEW_PATH=(.+)/);
      const reportMatch = stdout.match(/Report saved to:\s*(.+)/);
      const filePath = (match && match[1].trim()) || (reportMatch && reportMatch[1].trim());
      resolve({ ok: true, stdout, filePath });
    });
  });
}

app.post("/api/preview-status-email", async (req, res) => {
  try {
    const result = await runAdoReport(true);
    if (!result.ok) return res.json(result);
    if (!result.filePath || !fs.existsSync(result.filePath)) {
      return res.json({ ok: false, error: "Report file not found" });
    }
    const html = fs.readFileSync(result.filePath, "utf8");
    res.json({ ok: true, html, filePath: result.filePath });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post("/api/send-status-email", async (req, res) => {
  try {
    const result = await runAdoReport(false);
    if (result.ok) {
      res.json({ ok: true, message: "Status email sent successfully!" });
    } else {
      res.json(result);
    }
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post("/api/send-edited-email", async (req, res) => {
  try {
    const { html } = req.body;
    if (!html) return res.json({ ok: false, error: "No HTML content provided" });

    // Save edited HTML to reports folder
    const reportsDir = path.join(ADO_REPORT_DIR, "reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[T:.-]/g, "").slice(0, 15);
    const reportFile = path.join(reportsDir, `ADO_Report_${timestamp}_edited.html`);
    fs.writeFileSync(reportFile, html, "utf8");

    // Read config for recipients and subject
    const configPath = path.join(ADO_REPORT_DIR, "config.json");
    if (!fs.existsSync(configPath)) {
      return res.json({ ok: false, error: "config.json not found" });
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const recipients = (config.Email && config.Email.Recipients) || [];
    const subject = `${(config.Email && config.Email.Subject) || "ADO Report"} - ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;

    if (recipients.length === 0) {
      return res.json({ ok: false, error: "No recipients configured" });
    }

    // Build PowerShell to send via Outlook COM
    const recipientsCmds = recipients.map(r => `$mail.Recipients.Add('${r.replace(/'/g, "''")}') | Out-Null`).join("; ");
    const psScript = `
      $htmlBody = Get-Content -Path '${reportFile.replace(/'/g, "''")}' -Raw -Encoding UTF8
      $outlook = New-Object -ComObject Outlook.Application
      $mail = $outlook.CreateItem(0)
      $mail.Subject = '${subject.replace(/'/g, "''")}'
      $mail.HTMLBody = $htmlBody
      ${recipientsCmds}
      $mail.Recipients.ResolveAll() | Out-Null
      $mail.Send()
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($mail) | Out-Null
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook) | Out-Null
      Write-Host 'EMAIL_SENT_OK'
    `;

    const result = await new Promise((resolve) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript], {
        cwd: ADO_REPORT_DIR, shell: false,
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("error", (err) => resolve({ ok: false, error: err.message }));
      child.on("close", (code) => {
        if (code !== 0 || !stdout.includes("EMAIL_SENT_OK")) {
          return resolve({ ok: false, error: stderr || stdout || `Exit code ${code}` });
        }
        resolve({ ok: true });
      });
    });

    if (result.ok) {
      res.json({ ok: true, message: "Edited email sent successfully!" });
    } else {
      res.json(result);
    }
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

// Safety net: log unhandled errors without crashing the server
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const server = app.listen(PORT, () => {
  console.log(`\nXML Generator UI  →  http://localhost:${PORT}\n`);
});

// Allow long-running booking requests (up to 10 minutes) — skip on iisnode (named pipe)
if (typeof PORT === "number" || /^\d+$/.test(PORT)) {
  server.timeout = 0;
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 620000;
}
