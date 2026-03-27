"use strict";

const express = require("express");
const path = require("path");
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

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nXML Generator UI  →  http://localhost:${PORT}\n`);
});
