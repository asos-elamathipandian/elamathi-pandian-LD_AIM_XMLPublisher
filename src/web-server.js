"use strict";

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
const { uploadFileToSftp } = require("./sftp");
const { buildSftpConfigFromEnv } = require("./sftp-config");
const {
  getAbvCounterFile,
  getCarrierSequenceFile,
  getOutputDir,
  loadEnvironment,
} = require("./app-config");

loadEnvironment();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

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

// ── Generate All (order: VBKCON → BST → Shipment → FCBKC → RCV → PADEX) ─────

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

      child.stdout.on("data", (data) => { stdout += data.toString(); });
      child.stderr.on("data", (data) => { stderr += data.toString(); });

      child.on("close", (code) => {
        clearTimeout(timeoutHandle);
        const merged = `${stdout}\n${stderr}`;

        // Try new structured JSON output first
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

function processBookingQueue() {
  if (bookingInProgress || bookingQueue.length === 0) return;
  bookingInProgress = true;
  const { asn, specFile, resolve } = bookingQueue.shift();
  executeBooking(asn, specFile, resolve);
}

async function executeBooking(asn, specFile, resolve) {
  const asnsForFile = asn
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .join(",");
  const asnFilePath = path.join(PLAYWRIGHT_PROJECT, "tests", "asns.txt");
  const resultsFilePath = path.join(PLAYWRIGHT_PROJECT, "booking-results.json");

  // Clean up any previous results file
  try { fs.unlinkSync(resultsFilePath); } catch (_) {}

  try {
    fs.writeFileSync(asnFilePath, asnsForFile, "utf-8");
  } catch (e) {
    bookingInProgress = false;
    processBookingQueue();
    return resolve({ ok: false, error: `Failed to write ASN file: ${e.message}` });
  }

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

  child.stdout.on("data", (data) => { stdout += data.toString(); });
  child.stderr.on("data", (data) => { stderr += data.toString(); });

  child.on("close", (code) => {
    clearTimeout(timeoutHandle);

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

// Allow long-running booking requests (up to 10 minutes)
server.timeout = 0;              // no socket timeout
server.requestTimeout = 0;       // no request timeout
server.headersTimeout = 0;       // no headers timeout
server.keepAliveTimeout = 620000; // 10+ min keep-alive
