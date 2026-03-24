# XML Generator & Uploader

This project generates the below XML files which flows from the Carriers to E2Open system and can upload the generated files to SFTP for processing in E2Open:

- VBKCON
- Carrier Shipment
- Bulk Status

It supports both one-time CLI execution and Model Context Protocol (MCP) tool usage.

## MCP Requirement

If you want to use MCP tools (`generate_vbkcon`, `generate_carrier_shipment`, `generate_bulk_status`) from Copilot/agent mode, the MCP server in this repo must be installed and registered in VS Code.

If you only use CLI commands, MCP installation is not required.

## Features

- Generate VBKCON XML files with automatically incremented ABV values
- Generate carrier shipment XML files with automatically incremented sequence numbers
- Generate bulk status XML files from ASN input
- Upload generated files to SFTP
- Run as an MCP server or as standalone scripts
- Keep runtime state outside tracked source files

## Prerequisites

- Node.js 18+
- npm
- SFTP credentials, or a private key with optional passphrase

## Project Structure

- `src/`: XML generation, config loading, MCP server, and upload logic
- `config/.env.example`: environment variable template
- `config/inputs.example.json`: sample local input values for CLI usage
- `output/`: generated XML output at runtime
- `resources/`: source/sample XML resources
- `state/`: runtime counter and sequence files created locally at runtime

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a local environment file:

```bash
copy config\.env.example config\.env
```

3. Create a local inputs file for CLI usage:

```bash
copy config\inputs.example.json config\inputs.json
```

4. Update `config/.env` with your SFTP details.

5. Update `config/inputs.json` with the local default values you want to use.

## MCP Installation (Required For MCP Tool Usage)

1. For full project setup (including CLI scripts), use:

```bash
npm install
```

2. Ensure the MCP server entry exists in `.vscode/mcp.json`:

```json
{
  "servers": {
    "vbkcon-generator-agent": {
      "command": "node",
      "args": ["src/server.js"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

3. Reload VS Code window so MCP server definitions are re-read.

4. In Copilot chat/agent mode, verify the tools are available:
   - `generate_vbkcon`
   - `generate_carrier_shipment`
   - `generate_bulk_status`

If these tools do not appear, the MCP server is not installed/registered correctly yet.

## Environment Variables

The application loads `config/.env` first, then falls back to a root `.env` if present.

Required SFTP configuration:

- `SFTP_HOST`
- `SFTP_USERNAME`
- `SFTP_REMOTE_DIR`

Authentication:

- `SFTP_PASSWORD`, or
- `SFTP_PRIVATE_KEY_PATH` with optional `SFTP_PASSPHRASE`

Optional settings:

- `SFTP_PORT`: defaults to `22`
- `OUTPUT_DIR`: defaults to `output`
- `STATE_DIR`: defaults to `state`
- `ABV_COUNTER_FILE`: overrides the default VBKCON counter file path
- `CARRIER_SEQUENCE_FILE`: overrides the default carrier shipment sequence file path

## CLI Usage

Generate VBKCON:

```bash
npm run generate:once -- <ACE>
```

Generate carrier shipment:

```bash
npm run generate:shipment -- <ASN> <PO> <SKU>
```

Generate bulk status:

```bash
npm run generate:bst -- <ASN>
```

Skip upload for any CLI command by adding `--no-upload`.

If values are omitted, the CLI scripts read defaults from `config/inputs.json`.

Recommended `config/inputs.json` shape for shared defaults:

```json
{
  "asn": "51470000001194",
  "po": "500034214743",
  "sku": "140260042",
   "skuQty": "1",
   "ace": "VB-0000002044",
   "carrier": "DT"
 }
 ```
 
 `asn` is shared across carrier shipment and bulk status when CLI ASN arguments are omitted.
 `po` and `sku` are shared defaults for carrier shipment when CLI PO/SKU arguments are omitted.
 `skuQty` is the SKU quantity used in carrier shipment SQ measure when CLI SKU_QTY argument is omitted (defaults to "1").
 `carrier` can be any one of these values: `DT`, `Maersk`, or `Advanced`.
Start the MCP server:

```bash
npm run start:mcp
```

Available tools:

- `generate_vbkcon`
  - `ace` (required)
  - `uploadToSftp` (optional, default `true`)
- `generate_carrier_shipment`
  - `asn` (required)
  - `po` (required)
  - `sku` (required)
  - `uploadToSftp` (optional, default `true`)
- `generate_bulk_status`
  - `asn` (required)
  - `uploadToSftp` (optional, default `true`)

## Runtime Files

The following files are local runtime artifacts and are excluded from source control:

- `config/.env`
- `config/inputs.json`
- `config/*.ppk`
- `output/`
- `state/`

The `state/` directory holds generated runtime state such as the next ABV counter and carrier shipment sequence number.

## Security Notes

- Do not commit `config/.env`
- Do not commit private keys or `.ppk` files
- Do not commit generated XML payloads
- Use `config/.env.example` and `config/inputs.example.json` as templates only
- If a real secret was ever committed or shared, rotate it before publishing the repo

## Preparing for ADO Git

Recommended flow:

1. Verify `config/.env`, `config/inputs.json`, private keys, and generated output are ignored
2. Initialize git if needed
3. Add the Azure DevOps remote
4. Commit only source, templates, and documentation
5. Push the cleaned repo
