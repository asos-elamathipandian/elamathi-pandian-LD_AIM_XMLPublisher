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
    request.params.name !== "generate_asn_padex"
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

  const parsed = inputSchema.safeParse(request.params.arguments ?? {});
  if (!parsed.success) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: false,
              error: parsed.error.flatten(),
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  const { abv, ace, carrier, uploadToSftp } = parsed.data;

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
