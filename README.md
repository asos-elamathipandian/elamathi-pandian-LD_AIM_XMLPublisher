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

- Node.js 18+ ([download](https://nodejs.org/))
- npm (included with Node.js)
- SFTP credentials, or a private key (`.ppk`) with optional passphrase
- Git access to the ADO repository

## Getting Started (For New Team Members)

Follow these one-time steps to set up the tool on your machine:

1. **Install Node.js 18+** from [nodejs.org](https://nodejs.org/). Verify with:

   ```bash
   node -v
   ```

2. **Clone the repository** from Azure DevOps:

   ```bash
   git clone <ADO-repo-URL>
   cd XMLGeneratorUploader
   ```

3. **Install dependencies:**

   ```bash
   npm install
   ```

4. **Create your local environment file** (SFTP connection details):

   ```bash
   copy config\.env.example config\.env
   ```

   Open `config/.env` and fill in the SFTP credentials (host, username, private key path or password, remote directory). Ask the team lead if you don't have these.

5. **Place the SFTP private key** (`.ppk` file) inside the `config/` folder, then set `SFTP_PRIVATE_KEY_PATH` in `config/.env` to point to it (e.g., `config/asos-david-ayres.ppk`).

6. **Create your local inputs file** (optional — provides default values so you don't have to type them every time):

   ```bash
   copy config\inputs.example.json config\inputs.json
   ```

   Update `config/inputs.json` with your preferred default ASN, PO, SKU, etc.

### Using the Web UI

Run the web server:

```bash
npm start
```

Open your browser to **http://localhost:3000** — fill in the form and click the buttons to generate and upload XML files.

> **Note:** The server runs as long as the terminal is open. To keep it running in the background without a terminal window, you can use [pm2](https://pm2.keymetrics.io/):
>
> ```bash
> npm install -g pm2
> pm2 start src/web-server.js --name xml-toolkit
> ```
>
> `pm2 stop xml-toolkit` to stop, `pm2 restart xml-toolkit` after pulling updates.

### Using the CLI

Run any generator directly from the terminal (no browser needed):

```bash
npm run generate:once -- <ACE>
npm run generate:shipment -- <ASN> <PO> <SKU>
npm run generate:bst -- <ASN>
```

### Using MCP Tools (VS Code Copilot)

See the [MCP Installation](#mcp-installation-required-for-mcp-tool-usage) section below.

## Project Structure

- `src/`: XML generation, config loading, MCP server, and upload logic
- `config/.env.example`: environment variable template
- `config/inputs.example.json`: sample local input values for CLI usage
- `output/`: generated XML output at runtime
- `resources/`: source/sample XML resources
- `state/`: runtime counter and sequence files created locally at runtime

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
