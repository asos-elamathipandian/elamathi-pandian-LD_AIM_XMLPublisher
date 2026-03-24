const path = require("path");
const fs = require("fs/promises");
const { getCarrierSequenceFile } = require("./app-config");

function pad(number, size = 2) {
  return String(number).padStart(size, "0");
}

function formatCtrlNumber(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function formatTimestamp(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    " ",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function formatFileTimestamp(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function addDays(date, days) {
  const output = new Date(date.getTime());
  output.setUTCDate(output.getUTCDate() + days);
  return output;
}

function formatDateYYYYMMDD(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("");
}

async function getNextSequence(sequenceFile = getCarrierSequenceFile()) {
  let lastSequence = 1000;

  try {
    const content = await fs.readFile(sequenceFile, "utf8");
    const parsed = JSON.parse(content);
    if (typeof parsed.lastSequence === "number") {
      lastSequence = parsed.lastSequence;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const nextSequence = lastSequence + 1;
  await fs.mkdir(path.dirname(sequenceFile), { recursive: true });
  await fs.writeFile(
    sequenceFile,
    JSON.stringify({ lastSequence: nextSequence }, null, 2),
    "utf8"
  );

  return nextSequence;
}

function buildCarrierShipmentXml({ asn, po, sku, now, sequence }) {
  const ctrlNumber = formatCtrlNumber(now);
  const transmissionTimestamp = formatTimestamp(now);
  const csi = `AEE00000${sequence}`;
  const catn = `ATJEE00000${sequence}`;
  const doDate = formatDateYYYYMMDD(addDays(now, 8));
  const manDate = formatDateYYYYMMDD(addDays(now, 9));
  const eqOrFpKey = `AH${sequence}AE / A${sequence}BE`;

  return `<XMLBundle>\n<XMLTransmission CtrlNumber="${ctrlNumber}" Receiver="E2ASOS" Sender="DAVIESTN" Timestamp="${transmissionTimestamp}">\n<XMLGroup CtrlNumber="${ctrlNumber}" GroupType="BP" IncludedMessages="2">\n<XMLTransaction CtrlNumber="${ctrlNumber}" TransactionType="BPM-856">\n<BpMessage MessageType="856" PurposeCd="04">\n<Mode>30</Mode>\n<Reference RefTypeCd="SC" SourceRefTypeCd="128">TR</Reference>\n<Reference RefTypeCd="SHTYPE" SourceRefTypeCd="128">ASN</Reference>\n<Reference RefTypeCd="TF" SourceRefTypeCd="128">CFS/CY</Reference>\n<Reference RefTypeCd="CSI" SourceRefTypeCd="128">${csi}</Reference>\n<Reference RefTypeCd="EXCP" SourceRefTypeCd="128">Compliant</Reference>\n<Reference RefTypeCd="NONCP" SourceRefTypeCd="128">Compliant</Reference>\n<Reference RefTypeCd="LD" SourceRefTypeCd="128">LTL</Reference>\n<Reference RefTypeCd="CATN" SourceRefTypeCd="128">${catn}</Reference>\n<Date DateTypeCd="DO" TimeZone="">${doDate}</Date>\n<Date DateTypeCd="MAN" TimeZone="">${manDate}</Date>\n<TradePartner RoleCd="CA">\n<TradePartnerName>Davies Turner</TradePartnerName>\n<TradePartnerID Qualifier="93">DT</TradePartnerID>\n</TradePartner>\n<TradePartner RoleCd="FD">\n<TradePartnerName>FC01 Asos Barnsley</TradePartnerName>\n<TradePartnerID Qualifier="93">FC01</TradePartnerID>\n<TradePartnerAddress>\n<City>Grimethorpe</City>\n<CountryCd>GB</CountryCd>\n</TradePartnerAddress>\n</TradePartner>\n<TradePartner RoleCd="FS">\n<TradePartnerName>FC01 Asos Barnsley</TradePartnerName>\n<TradePartnerID Qualifier="93">FC01</TradePartnerID>\n<TradePartnerAddress>\n<City>Grimethorpe</City>\n<CountryCd>GB</CountryCd>\n</TradePartnerAddress>\n</TradePartner>\n<Document DocType="SHIP" Key="${asn}">\n<DocumentID>${asn}</DocumentID>\n<Measure Qualifier="WGT" SourceQualifier="738" SourceUOMCd="355" UOMCd="KG">2</Measure>\n<Order Key="${po}" OrderType="PO">\n<OrderID>${po}</OrderID>\n<LineItem Key="${sku}">\n<Attribute AttributeTypeCd="SK">${sku}</Attribute>\n<Measure EqOrFpKey="${eqOrFpKey}" Qualifier="SQ" SourceUOMCd="355" UOMCd="UN">1</Measure>\n</LineItem>\n</Order>\n</Document>\n<Equipment Key="${eqOrFpKey}">\n<EquipmentNumber>${eqOrFpKey}</EquipmentNumber>\n<EquipmentDescCd>TL</EquipmentDescCd>\n<Reference RefTypeCd="SN"/>\n</Equipment>\n<Relationship DocKey="${asn}" EqKey="${eqOrFpKey}"/>\n</BpMessage>\n</XMLTransaction>\n</XMLGroup>\n</XMLTransmission>\n</XMLBundle>\n`;
}

async function writeCarrierShipmentFile({
  asn,
  po,
  sku,
  outputDir,
  sequenceFile,
}) {
  const now = new Date();
  const sequence = await getNextSequence(sequenceFile);
  const xmlContent = buildCarrierShipmentXml({
    asn,
    po,
    sku,
    now,
    sequence,
  });

  const fileTimestamp = formatFileTimestamp(now);
  const fileName = `DAVIESTN_E2ASOS_Shipment_1.0_${fileTimestamp}_${asn}.xml`;
  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, fileName);

  await fs.mkdir(absoluteOutputDir, { recursive: true });
  await fs.writeFile(filePath, xmlContent, "utf8");

  return {
    fileName,
    filePath,
    xmlContent,
    sequence,
  };
}

module.exports = {
  writeCarrierShipmentFile,
};
