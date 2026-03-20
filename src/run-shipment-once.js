const { writeCarrierShipmentFile } = require("./carrier-shipment");
const { uploadFileToSftp } = require("./sftp");
const { buildSftpConfigFromEnv } = require("./sftp-config");
const {
  getCarrierSequenceFile,
  getOutputDir,
  loadEnvironment,
  loadInputsFile,
} = require("./app-config");

loadEnvironment();

async function main() {
  const args = process.argv.slice(2).filter(a => a !== "--no-upload");
  const noUpload = process.argv.includes("--no-upload");
  let [asn, po, sku] = args;

  if (!asn || !po || !sku) {
    const inputs = loadInputsFile();
    asn = asn || (inputs.shipment && inputs.shipment.asn);
    po  = po  || (inputs.shipment && inputs.shipment.po);
    sku = sku || (inputs.shipment && inputs.shipment.sku);
  }

  if (!asn || !po || !sku) {
    throw new Error(
      "Usage: node src/run-shipment-once.js <ASN> <PO> <SKU> [--no-upload]\n" +
      "  Or set shipment.asn, shipment.po, and shipment.sku in config/inputs.json"
    );
  }

  const outputDir = getOutputDir(process.env);

  const generated = await writeCarrierShipmentFile({
    asn,
    po,
    sku,
    outputDir,
    sequenceFile: getCarrierSequenceFile(process.env),
  });

  const result = {
    ok: true,
    fileName: generated.fileName,
    filePath: generated.filePath,
    sequence: generated.sequence,
    uploaded: false,
  };

  if (!noUpload) {
    const sftpConfig = buildSftpConfigFromEnv(process.env);

    const uploadResult = await uploadFileToSftp({
      localFilePath: generated.filePath,
      remoteDir: sftpConfig.remoteDir,
      connectionOptions: sftpConfig.connectionOptions,
    });

    result.uploaded = true;
    result.remotePath = uploadResult.remotePath;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
