const { z } = require("zod");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { writeVbkconFile } = require("./vbkcon");
const { writeCarrierShipmentFile } = require("./carrier-shipment");
const { writeBulkStatusFile } = require("./bulk-status");
const { writeAsnFcbkcFile } = require("./asn-fcbkc");
const { writeAsnRcvFile } = require("./asn-rcv");
const { writeAsnPadexFile } = require("./asn-padex");
const { writeAsnFeedFile } = require("./asn-feed");
const { writeGpmFile } = require("./gpm");
const { writePoFeedFile } = require("./po-feed");
const { searchBlobsByAsn, downloadBlobs } = require("./blob-search");
const { uploadFileToSftp } = require("./sftp");
const { buildSftpConfigFromEnv } = require("./sftp-config");
const {
  getAbvCounterFile,
  getCarrierSequenceFile,
  getOutputDir,
  loadEnvironment,
} = require("./app-config");

loadEnvironment();

const inputSchema = z.object({
  abv: z.string().min(1, "abv is required"),
  ace: z.string().min(1, "ace is required"),
  carrier: z.string().optional().default("DT"),
  uploadToSftp: z.boolean().optional().default(true),
});

const shipmentInputSchema = z.object({
  asn: z.string().min(1, "asn is required"),
  po: z.string().min(1, "po is required"),
  sku: z.string().min(1, "sku is required"),
  skuQty: z.string().optional().default("1"),
  carrier: z.string().optional().default("DT"),
  uploadToSftp: z.boolean().optional().default(true),
});

const bulkStatusInputSchema = z.object({
  asn: z.string().min(1, "asn is required"),
  uploadToSftp: z.boolean().optional().default(true),
});

const asnFcbkcInputSchema = z.object({
  asn: z.string().min(1, "asn is required"),
  uploadToSftp: z.boolean().optional().default(true),
});

const asnRcvInputSchema = z.object({
  asn: z.string().min(1, "asn is required"),
  uploadToSftp: z.boolean().optional().default(true),
});

const asnPadexInputSchema = z.object({
  asn: z.string().min(1, "asn is required"),
  po: z.string().min(1, "po is required"),
  sku: z.string().min(1, "sku is required"),
  uploadToSftp: z.boolean().optional().default(true),
});

const asnFeedInputSchema = z.object({
  asn: z.string().min(1, "asn is required"),
  po: z.string().min(1, "po is required"),
  sku: z.string().min(1, "sku is required"),
  skuQty: z.string().optional().default("1"),
  uploadToSftp: z.boolean().optional().default(true),
});

const gpmInputSchema = z.object({
  sku: z.string().min(1, "sku is required"),
  optionId: z.string().min(1, "optionId is required"),
  uploadToSftp: z.boolean().optional().default(true),
});

const poFeedInputSchema = z.object({
  po: z.string().min(1, "po is required"),
  sku: z.string().min(1, "sku is required"),
  skuQty: z.string().optional().default("1"),
  optionId: z.string().min(1, "optionId is required"),
  carrier: z.string().optional().default("DT"),
  uploadToSftp: z.boolean().optional().default(true),
});

const server = new Server(
  {
    name: "vbkcon-generator-agent",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "generate_vbkcon",
        description:
          "Generate a VBKCON XML file from ABV and ACE and optionally upload it to SFTP.",
        inputSchema: {
          type: "object",
          properties: {
            abv: {
              type: "string",
              description: "ABV reference to use in Document and ABV Reference nodes",
            },
            ace: {
              type: "string",
              description: "ACE reference to use in ACE Reference node",
            },
            carrier: {
              type: "string",
              description: "Carrier value used to set CA values and file prefix. Allowed: DT, Maersk, Advanced",
              default: "DT",
            },
            uploadToSftp: {
              type: "boolean",
              description: "If true, upload generated file to configured SFTP path",
              default: true,
            },
          },
          required: ["abv", "ace"],
        },
      },
      {
        name: "generate_carrier_shipment",
        description:
          "Generate a carrier shipment XML file from ASN, PO, and SKU and optionally upload it to SFTP.",
        inputSchema: {
          type: "object",
          properties: {
            asn: {
              type: "string",
              description: "ASN value used for Document Key, DocumentID, and Relationship DocKey",
            },
            po: {
              type: "string",
              description: "PO value used for Order Key and OrderID",
            },
            sku: {
              type: "string",
              description: "SKU value used for LineItem Key and SK Attribute",
            },
            skuQty: {
              type: "string",
              description: "SKU quantity value for each line item (single value or comma-separated values)",
              default: "1",
            },
            carrier: {
              type: "string",
              description: "Carrier value used to set CA ID and file prefix. Allowed: DT, Maersk, Advanced",
              default: "DT",
            },
            uploadToSftp: {
              type: "boolean",
              description: "If true, upload generated file to configured SFTP path",
              default: true,
            },
          },
          required: ["asn", "po", "sku"],
        },
      },
      {
        name: "generate_bulk_status",
        description:
          "Generate a bulk status (BST) XML file from ASN and optionally upload it to SFTP.",
        inputSchema: {
          type: "object",
          properties: {
            asn: {
              type: "string",
              description: "ASN value used for Transaction CtrlNumber, Document Key and DocumentID",
            },
            uploadToSftp: {
              type: "boolean",
              description: "If true, upload generated file to configured SFTP path",
              default: true,
            },
          },
          required: ["asn"],
        },
      },
      {
        name: "generate_asn_fcbkc",
        description:
          "Generate an ASN FCBKC milestone XML file from ASN and optionally upload it to SFTP.",
        inputSchema: {
          type: "object",
          properties: {
            asn: {
              type: "string",
              description: "ASN value used for XMLTransaction CtrlNumber, Document Key and DocumentID",
            },
            uploadToSftp: {
              type: "boolean",
              description: "If true, upload generated file to configured SFTP path",
              default: true,
            },
          },
          required: ["asn"],
        },
      },
      {
        name: "generate_asn_rcv",
        description:
          "Generate an ASN RCV XML file containing both RCV_FRSTD and RCV_FNLD milestones from ASN and optionally upload it to SFTP.",
        inputSchema: {
          type: "object",
          properties: {
            asn: {
              type: "string",
              description: "ASN value used for XMLTransaction CtrlNumber, Document Key and DocumentID",
            },
            uploadToSftp: {
              type: "boolean",
              description: "If true, upload generated file to configured SFTP path",
              default: true,
            },
          },
          required: ["asn"],
        },
      },
      {
        name: "generate_asn_padex",
        description:
          "Generate an ASN PADEX XML file from ASN, PO, and SKU and optionally upload it to SFTP.",
        inputSchema: {
          type: "object",
          properties: {
            asn: {
              type: "string",
              description: "ASN value used for XMLTransaction CtrlNumber, Document Key and DocumentID",
            },
            po: {
              type: "string",
              description: "PO value used for Order Key and OrderID",
            },
            sku: {
              type: "string",
              description: "SKU value used for LineItem Key and SK Attribute",
            },
            uploadToSftp: {
              type: "boolean",
              description: "If true, upload generated file to configured SFTP path",
              default: true,
            },
          },
          required: ["asn", "po", "sku"],
        },
      },
      {
        name: "generate_asn_feed",
        description:
          "Generate an ASN Feed (856) XML file from ASN, PO, SKU and SKU Qty and optionally upload it to SFTP.",
        inputSchema: {
          type: "object",
          properties: {
            asn: {
              type: "string",
              description: "ASN value used for Document Key and DocumentID",
            },
            po: {
              type: "string",
              description: "PO value used for Order Key and OrderID",
            },
            sku: {
              type: "string",
              description: "SKU value used for LineItem Key and SK Attribute (comma-separated for multiple)",
            },
            skuQty: {
              type: "string",
              description: "SKU quantity for each line item (single or comma-separated)",
              default: "1",
            },
            uploadToSftp: {
              type: "boolean",
              description: "If true, upload generated file to configured SFTP path",
              default: true,
            },
          },
          required: ["asn", "po", "sku"],
        },
      },
      {
        name: "generate_gpm",
        description:
          "Generate a GPM (SKU Re-trigger) XML file from SKU and Option ID and optionally upload it to SFTP.",
        inputSchema: {
          type: "object",
          properties: {
            sku: {
              type: "string",
              description: "SKU ID used for PROD_ID and related fields",
            },
            optionId: {
              type: "string",
              description: "Option ID used for OPTION_ID field",
            },
            uploadToSftp: {
              type: "boolean",
              description: "If true, upload generated file to configured SFTP path",
              default: true,
            },
          },
          required: ["sku", "optionId"],
        },
      },
      {
        name: "generate_po_feed",
        description:
          "Generate a PO Feed (850) XML file from PO, SKU, SKU Qty, and Carrier and optionally upload it to SFTP.",
        inputSchema: {
          type: "object",
          properties: {
            po: {
              type: "string",
              description: "PO value used for Order Key and OrderID",
            },
            sku: {
              type: "string",
              description: "SKU value used for LineItem Key and SK Attribute (comma-separated for multiple)",
            },
            skuQty: {
              type: "string",
              description: "SKU quantity for each line item (single or comma-separated)",
              default: "1",
            },
            optionId: {
              type: "string",
              description: "Option ID used for PT Reference in each LineItem",
            },
            carrier: {
              type: "string",
              description: "Carrier for CA TradePartner. Allowed: DT, Maersk, Advanced",
              default: "DT",
            },
            uploadToSftp: {
              type: "boolean",
              description: "If true, upload generated file to configured SFTP path",
              default: true,
            },
          },
          required: ["po", "sku", "optionId"],
        },
      },
      {
        name: "search_blob_by_asn",
        description:
          "Search Azure Blob Storage (sftp-inbound container) for XML files that contain a given ASN in their content. Returns matching file names with download links.",
        inputSchema: {
          type: "object",
          properties: {
            asn: {
              type: "string",
              description: "ASN reference to search for inside XML blob content",
            },
            hoursBack: {
              type: "number",
              description: "Only scan blobs modified within this many hours (default 48)",
              default: 48,
            },
            maxBlobs: {
              type: "number",
              description: "Maximum number of blobs to scan (default 200)",
              default: 200,
            },
          },
          required: ["asn"],
        },
      },
      {
        name: "download_blobs",
        description:
          "Download specific blob files from Azure Blob Storage to the local output directory. Use after search_blob_by_asn to save matched files locally.",
        inputSchema: {
          type: "object",
          properties: {
            blobNames: {
              type: "array",
              items: { type: "string" },
              description: "Array of full blob paths to download (e.g. IN/2026/04/23/file.xml)",
            },
          },
          required: ["blobNames"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (
    request.params.name !== "generate_vbkcon" &&
    request.params.name !== "generate_carrier_shipment" &&
    request.params.name !== "generate_bulk_status" &&
    request.params.name !== "generate_asn_fcbkc" &&
    request.params.name !== "generate_asn_rcv" &&
    request.params.name !== "generate_asn_padex" &&
    request.params.name !== "generate_asn_feed" &&
    request.params.name !== "generate_gpm" &&
    request.params.name !== "generate_po_feed" &&
    request.params.name !== "search_blob_by_asn" &&
    request.params.name !== "download_blobs"
  ) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const outputDir = getOutputDir(process.env);

  if (request.params.name === "generate_carrier_shipment") {
    const parsedShipment = shipmentInputSchema.safeParse(request.params.arguments ?? {});
    if (!parsedShipment.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                error: parsedShipment.error.flatten(),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const { asn, po, sku, skuQty, carrier, uploadToSftp } = parsedShipment.data;
    const generated = await writeCarrierShipmentFile({
      asn,
      po,
      sku,
      skuQty,
      carrier,
      outputDir,
      sequenceFile: getCarrierSequenceFile(process.env),
    });

    const response = {
      ok: true,
      fileName: generated.fileName,
      filePath: generated.filePath,
      sequence: generated.sequence,
      uploaded: false,
    };

    if (uploadToSftp) {
      const sftpConfig = buildSftpConfigFromEnv(process.env);

      const uploadResult = await uploadFileToSftp({
        localFilePath: generated.filePath,
        remoteDir: sftpConfig.remoteDir,
        connectionOptions: sftpConfig.connectionOptions,
      });

      response.uploaded = true;
      response.remotePath = uploadResult.remotePath;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  if (request.params.name === "generate_bulk_status") {
    const parsedBulkStatus = bulkStatusInputSchema.safeParse(
      request.params.arguments ?? {}
    );
    if (!parsedBulkStatus.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                error: parsedBulkStatus.error.flatten(),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const { asn, uploadToSftp } = parsedBulkStatus.data;
    const generated = await writeBulkStatusFile({
      asn,
      outputDir,
    });

    const response = {
      ok: true,
      fileName: generated.fileName,
      filePath: generated.filePath,
      uploaded: false,
    };

    if (uploadToSftp) {
      const sftpConfig = buildSftpConfigFromEnv(process.env);

      const uploadResult = await uploadFileToSftp({
        localFilePath: generated.filePath,
        remoteDir: sftpConfig.remoteDir,
        connectionOptions: sftpConfig.connectionOptions,
      });

      response.uploaded = true;
      response.remotePath = uploadResult.remotePath;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  if (request.params.name === "generate_asn_fcbkc") {
    const parsedFcbkc = asnFcbkcInputSchema.safeParse(request.params.arguments ?? {});
    if (!parsedFcbkc.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: parsedFcbkc.error.flatten() }, null, 2),
          },
        ],
        isError: true,
      };
    }

    const { asn, uploadToSftp } = parsedFcbkc.data;
    const generated = await writeAsnFcbkcFile({ asn, outputDir });

    const response = {
      ok: true,
      fileName: generated.fileName,
      filePath: generated.filePath,
      uploaded: false,
    };

    if (uploadToSftp) {
      const sftpConfig = buildSftpConfigFromEnv(process.env);
      const uploadResult = await uploadFileToSftp({
        localFilePath: generated.filePath,
        remoteDir: sftpConfig.remoteDir,
        connectionOptions: sftpConfig.connectionOptions,
      });
      response.uploaded = true;
      response.remotePath = uploadResult.remotePath;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  if (request.params.name === "generate_asn_rcv") {
    const parsedRcv = asnRcvInputSchema.safeParse(request.params.arguments ?? {});
    if (!parsedRcv.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: parsedRcv.error.flatten() }, null, 2),
          },
        ],
        isError: true,
      };
    }

    const { asn, uploadToSftp } = parsedRcv.data;
    const generated = await writeAsnRcvFile({ asn, outputDir });

    const response = {
      ok: true,
      fileName: generated.fileName,
      filePath: generated.filePath,
      uploaded: false,
    };

    if (uploadToSftp) {
      const sftpConfig = buildSftpConfigFromEnv(process.env);
      const uploadResult = await uploadFileToSftp({
        localFilePath: generated.filePath,
        remoteDir: sftpConfig.remoteDir,
        connectionOptions: sftpConfig.connectionOptions,
      });
      response.uploaded = true;
      response.remotePath = uploadResult.remotePath;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  if (request.params.name === "generate_asn_padex") {
    const parsedPadex = asnPadexInputSchema.safeParse(request.params.arguments ?? {});
    if (!parsedPadex.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: parsedPadex.error.flatten() }, null, 2),
          },
        ],
        isError: true,
      };
    }

    const { asn, po, sku, uploadToSftp } = parsedPadex.data;
    const generated = await writeAsnPadexFile({ asn, po, sku, skuQty: "1", outputDir });

    const response = {
      ok: true,
      fileName: generated.fileName,
      filePath: generated.filePath,
      uploaded: false,
    };

    if (uploadToSftp) {
      const sftpConfig = buildSftpConfigFromEnv(process.env);
      const uploadResult = await uploadFileToSftp({
        localFilePath: generated.filePath,
        remoteDir: sftpConfig.remoteDir,
        connectionOptions: sftpConfig.connectionOptions,
      });
      response.uploaded = true;
      response.remotePath = uploadResult.remotePath;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  if (request.params.name === "generate_gpm") {
    const parsedGpm = gpmInputSchema.safeParse(request.params.arguments ?? {});
    if (!parsedGpm.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: parsedGpm.error.flatten() }, null, 2),
          },
        ],
        isError: true,
      };
    }

    const { sku, optionId, uploadToSftp } = parsedGpm.data;
    const generated = await writeGpmFile({ sku, optionId, outputDir });

    const response = {
      ok: true,
      fileName: generated.fileName,
      filePath: generated.filePath,
      uploaded: false,
    };

    if (uploadToSftp) {
      const sftpConfig = buildSftpConfigFromEnv(process.env);
      const uploadResult = await uploadFileToSftp({
        localFilePath: generated.filePath,
        remoteDir: sftpConfig.remoteDir,
        connectionOptions: sftpConfig.connectionOptions,
      });
      response.uploaded = true;
      response.remotePath = uploadResult.remotePath;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  if (request.params.name === "generate_po_feed") {
    const parsedPo = poFeedInputSchema.safeParse(request.params.arguments ?? {});
    if (!parsedPo.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: parsedPo.error.flatten() }, null, 2),
          },
        ],
        isError: true,
      };
    }

    const { po, sku, skuQty, optionId, carrier, uploadToSftp } = parsedPo.data;
    const generated = await writePoFeedFile({ po, sku, skuQty, optionId, carrier, outputDir });

    const response = {
      ok: true,
      fileName: generated.fileName,
      filePath: generated.filePath,
      uploaded: false,
    };

    if (uploadToSftp) {
      const sftpConfig = buildSftpConfigFromEnv(process.env);
      const uploadResult = await uploadFileToSftp({
        localFilePath: generated.filePath,
        remoteDir: sftpConfig.remoteDir,
        connectionOptions: sftpConfig.connectionOptions,
      });
      response.uploaded = true;
      response.remotePath = uploadResult.remotePath;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  if (request.params.name === "generate_asn_feed") {
    const parsedFeed = asnFeedInputSchema.safeParse(request.params.arguments ?? {});
    if (!parsedFeed.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: parsedFeed.error.flatten() }, null, 2),
          },
        ],
        isError: true,
      };
    }

    const { asn, po, sku, skuQty, uploadToSftp } = parsedFeed.data;
    const generated = await writeAsnFeedFile({ asn, po, sku, skuQty, outputDir });

    const response = {
      ok: true,
      fileName: generated.fileName,
      filePath: generated.filePath,
      uploaded: false,
    };

    if (uploadToSftp) {
      const sftpConfig = buildSftpConfigFromEnv(process.env);
      const uploadResult = await uploadFileToSftp({
        localFilePath: generated.filePath,
        remoteDir: sftpConfig.remoteDir,
        connectionOptions: sftpConfig.connectionOptions,
      });
      response.uploaded = true;
      response.remotePath = uploadResult.remotePath;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  if (request.params.name === "search_blob_by_asn") {
    const blobInputSchema = z.object({
      asn: z.string().min(1, "asn is required"),
      hoursBack: z.number().optional().default(48),
      maxBlobs: z.number().optional().default(200),
    });
    const parsed = blobInputSchema.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: parsed.error.flatten() }, null, 2),
          },
        ],
        isError: true,
      };
    }

    const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
    if (!connectionString) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: "AZURE_BLOB_CONNECTION_STRING not configured in config/.env" }, null, 2),
          },
        ],
        isError: true,
      };
    }

    const { asn, hoursBack, maxBlobs } = parsed.data;
    const containerName = process.env.AZURE_BLOB_CONTAINER || "sftp-inbound";

    const result = await searchBlobsByAsn({
      asn,
      connectionString,
      containerName,
      hoursBack,
      maxBlobs,
    });

    const responseText = result.matches.length > 0
      ? `Found ${result.matches.length} file(s) containing ASN ${asn} (scanned ${result.scanned}, skipped ${result.skipped}):\n\n` +
        result.matches.map((m, i) =>
          `${i + 1}. ${m.name}\n   Size: ${(m.size / 1024).toFixed(1)} KB | Modified: ${m.lastModified}\n   URL: ${m.url}`
        ).join("\n\n")
      : `No files found containing ASN ${asn} (scanned ${result.scanned} blobs from the last ${hoursBack} hours)`;

    return {
      content: [
        {
          type: "text",
          text: responseText,
        },
      ],
    };
  }

  if (request.params.name === "download_blobs") {
    const dlSchema = z.object({
      blobNames: z.array(z.string()).min(1, "At least one blob name is required"),
    });
    const parsed = dlSchema.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: parsed.error.flatten() }, null, 2),
          },
        ],
        isError: true,
      };
    }

    const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
    if (!connectionString) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: "AZURE_BLOB_CONNECTION_STRING not configured in config/.env" }, null, 2),
          },
        ],
        isError: true,
      };
    }

    const containerName = process.env.AZURE_BLOB_CONTAINER || "sftp-inbound";
    const outputDir = getOutputDir(process.env);

    const result = await downloadBlobs({
      blobNames: parsed.data.blobNames,
      connectionString,
      containerName,
      outputDir,
    });

    const lines = [];
    if (result.downloaded.length > 0) {
      lines.push(`Downloaded ${result.downloaded.length} file(s) to ${outputDir}:`);
      result.downloaded.forEach((f, i) => lines.push(`  ${i + 1}. ${f}`));
    }
    if (result.failed.length > 0) {
      lines.push(`Failed to download ${result.failed.length} file(s):`);
      result.failed.forEach((f) => lines.push(`  - ${f.name}: ${f.error}`));
    }

    return {
      content: [
        {
          type: "text",
          text: lines.join("\n"),
        },
      ],
    };
  }

  // Default handler: generate_vbkcon
  const parsedVbkcon = inputSchema.safeParse(request.params.arguments ?? {});
  if (!parsedVbkcon.success) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: false,
              error: parsedVbkcon.error.flatten(),
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  const { abv, ace, carrier, uploadToSftp } = parsedVbkcon.data;

  const generated = await writeVbkconFile({
    abv,
    ace,
    carrier,
    outputDir,
    abvCounterFile: getAbvCounterFile(process.env),
  });

  const response = {
    ok: true,
    fileName: generated.fileName,
    filePath: generated.filePath,
    uploaded: false,
  };

  if (uploadToSftp) {
    const sftpConfig = buildSftpConfigFromEnv(process.env);

    const uploadResult = await uploadFileToSftp({
      localFilePath: generated.filePath,
      remoteDir: sftpConfig.remoteDir,
      connectionOptions: sftpConfig.connectionOptions,
    });

    response.uploaded = true;
    response.remotePath = uploadResult.remotePath;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`MCP server failed: ${error.message}\n`);
  process.exit(1);
});
