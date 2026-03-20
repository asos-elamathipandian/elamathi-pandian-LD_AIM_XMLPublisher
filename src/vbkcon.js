const path = require("path");
const fs = require("fs/promises");
const { getAbvCounterFile } = require("./app-config");

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
    pad(date.getUTCMilliseconds(), 3),
  ].join("");
}

function addDays(date, days) {
  const output = new Date(date.getTime());
  output.setUTCDate(output.getUTCDate() + days);
  return output;
}

function formatDateWithCurrentTime(date, now) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    " ",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
  ].join("");
}

function formatDateMidnight(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    " 0000",
  ].join("");
}

function buildVbkconXml({ abv, ace, now = new Date() }) {
  const ctrlNumber = formatCtrlNumber(now);
  const timestamp = formatTimestamp(now);
  const status135 = formatDateWithCurrentTime(addDays(now, 5), now);
  const status080 = formatDateMidnight(addDays(now, 6));

  return `<XMLBundle>\n<XMLTransmission CtrlNumber="${ctrlNumber}" Receiver="E2ASOS" Sender="DAVIESTN" Timestamp="${timestamp}">\n<XMLGroup CtrlNumber="${ctrlNumber}" GroupType="BP" IncludedMessages="1">\n<XMLTransaction CtrlNumber="${ctrlNumber}" TransactionType="BPM-VBKCON">\n<BpMessage MessageType="VBKCON" PurposeCd="00">\n<TradePartner RoleCd="CA">\n<TradePartnerName>Davies Turner</TradePartnerName>\n<TradePartnerID>3</TradePartnerID>\n</TradePartner>\n<TradePartner RoleCd="SU">\n<TradePartnerName>Difuzed - FOB</TradePartnerName>\n<TradePartnerID Qualifier="93">2002900003</TradePartnerID>\n</TradePartner>\n<Status>\n<Date DateTypeCd="135" TimeZone="UT">${status135}</Date>\n<Location LocTypeCd="L">\n<LocationID Qualifier="UN">POROP</LocationID>\n</Location>\n</Status>\n<Status>\n<Date DateTypeCd="080" TimeZone="UT">${status080}</Date>\n</Status>\n<Document DocType="BOOK" Key="BOOK_${abv}">\n<Reference RefTypeCd="ABV" SourceRefTypeCd="128">${abv}</Reference>\n<Reference RefTypeCd="ACE" SourceRefTypeCd="128">${ace}</Reference>\n<Reference RefTypeCd="V0" SourceRefTypeCd="128">1.0</Reference>\n</Document>\n</BpMessage>\n</XMLTransaction>\n</XMLGroup>\n</XMLTransmission>\n</XMLBundle>\n`;
}

async function getNextAbv(counterFilePath = getAbvCounterFile()) {
  let counter;
  try {
    const raw = await fs.readFile(counterFilePath, "utf8");
    counter = JSON.parse(raw);
  } catch {
    counter = { next: 6100 };
  }
  const abv = counter.next;
  counter.next = abv + 1;
  await fs.mkdir(path.dirname(counterFilePath), { recursive: true });
  await fs.writeFile(counterFilePath, JSON.stringify(counter, null, 2), "utf8");
  return String(abv);
}

async function writeVbkconFile({ ace, outputDir, abvCounterFile }) {
  const now = new Date();
  const abv = await getNextAbv(abvCounterFile);
  const xmlContent = buildVbkconXml({ abv, ace, now });
  const fileTimestamp = formatFileTimestamp(now);
  const fileName = `DAVIESTN_E2ASOS_VBKCON_1.0_${fileTimestamp}.xml`;
  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, fileName);

  await fs.mkdir(absoluteOutputDir, { recursive: true });
  await fs.writeFile(filePath, xmlContent, "utf8");

  return {
    fileName,
    filePath,
    abv,
    xmlContent,
  };
}

module.exports = {
  buildVbkconXml,
  writeVbkconFile,
};
