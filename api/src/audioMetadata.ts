const MAX_DURATION_SECONDS = 48 * 60 * 60;
const HEAD_BYTES = 512 * 1024;
const TAIL_BYTES = 512 * 1024;
const MAX_HEAD_BYTES = 4 * 1024 * 1024;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const MAX_BITRATE = 10_000_000;

export type EmbeddedCover = {
  bytes: Uint8Array;
  contentType: string;
};

export type AudioFacts = {
  durationSeconds: number | null;
  container: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
  album: string | null;
  artist: string | null;
  narrator: string | null;
  cover: EmbeddedCover | null;
};

type MutableFacts = {
  durationSeconds: number | null;
  container: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
  album: string | null;
  artist: string | null;
  narrator: string | null;
  cover: EmbeddedCover | null;
  vbr: boolean;
};

type WorkerDigestStream = WritableStream<Uint8Array> & { digest: Promise<ArrayBuffer> };

type WorkerCrypto = Crypto & {
  DigestStream?: new (algorithm: string) => WorkerDigestStream;
};

export function normalizeDurationSeconds(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_DURATION_SECONDS) return null;
  return value;
}

export function contentTypeForContainer(container: string | null, fallback: string): string {
  switch (container) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
    case "m4b":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    case "flac":
      return "audio/flac";
    case "aac":
      return "audio/aac";
    case "ogg":
    case "opus":
      return "audio/ogg";
    default:
      return fallback;
  }
}

export async function inspectR2Audio(
  bucket: R2Bucket,
  key: string,
  input: { sizeBytes: number; filename: string | null },
): Promise<{ facts: AudioFacts; checksum: string | null }> {
  const [facts, checksum] = await Promise.all([
    factsFromR2Object(bucket, key, input),
    checksumFromR2Object(bucket, key),
  ]);
  return { facts, checksum };
}

export async function factsFromR2Object(
  bucket: R2Bucket,
  key: string,
  input: { sizeBytes: number; filename: string | null },
): Promise<AudioFacts> {
  const empty = emptyFacts();
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return empty;
  try {
    const headLength = Math.min(HEAD_BYTES, input.sizeBytes);
    let head = await readRange(bucket, key, 0, headLength);
    if (!head) return empty;

    const id3Bytes = id3TagLength(head);
    if (id3Bytes > head.length && id3Bytes <= MAX_HEAD_BYTES && id3Bytes <= input.sizeBytes) {
      const wider = await readRange(bucket, key, 0, id3Bytes);
      if (wider) head = wider;
    }

    let tail: Uint8Array | null = null;
    if (input.sizeBytes > head.length) {
      const tailLength = Math.min(TAIL_BYTES, input.sizeBytes);
      tail = await readRange(bucket, key, input.sizeBytes - tailLength, tailLength);
    }

    return parseAudioFacts(head, tail, input);
  } catch {
    return empty;
  }
}

export async function checksumFromR2Object(bucket: R2Bucket, key: string): Promise<string | null> {
  try {
    const object = await bucket.get(key);
    if (!object?.body) return null;
    const digest = await sha256Stream(object.body);
    return digest ? hex(digest) : null;
  } catch {
    return null;
  }
}

export function parseAudioFacts(
  head: Uint8Array,
  tail: Uint8Array | null,
  input: { sizeBytes: number; filename: string | null },
): AudioFacts {
  const facts = emptyFacts();
  const fromName = containerFromFilename(input.filename);

  parseId3(head, facts);
  if (asciiEquals(head, 0, "RIFF")) parseWav(head, facts);
  else if (asciiEquals(head, 0, "fLaC")) parseFlac(head, facts);
  else if (asciiEquals(head, 4, "ftyp")) {
    parseMp4(head, facts);
    if (tail) parseMp4(tail, facts);
  } else {
    parseMp3Stream(head, facts);
    if (!facts.container) {
      parseMp4(head, facts);
      if (tail) parseMp4(tail, facts);
    }
  }

  if (!facts.container) facts.container = fromName;
  else if (facts.container === "m4a" && fromName === "m4b") facts.container = "m4b";

  const average = averageBitrate(input.sizeBytes, facts.durationSeconds);
  if (average != null && (!facts.bitrate || (facts.vbr && average >= 8_000))) {
    facts.bitrate = average;
  }

  return {
    durationSeconds: facts.durationSeconds,
    container: facts.container,
    bitrate: facts.bitrate,
    sampleRate: facts.sampleRate,
    channels: facts.channels,
    album: facts.album,
    artist: facts.artist,
    narrator: facts.narrator,
    cover: facts.cover,
  };
}

function emptyFacts(): MutableFacts {
  return {
    durationSeconds: null,
    container: null,
    bitrate: null,
    sampleRate: null,
    channels: null,
    album: null,
    artist: null,
    narrator: null,
    cover: null,
    vbr: false,
  };
}

async function readRange(
  bucket: R2Bucket,
  key: string,
  offset: number,
  length: number,
): Promise<Uint8Array | null> {
  const object = await bucket.get(key, { range: { offset, length } });
  if (!object) return null;
  return new Uint8Array(await object.arrayBuffer());
}

async function sha256Stream(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer | null> {
  const workerCrypto = crypto as WorkerCrypto;
  if (workerCrypto.DigestStream) {
    const digestStream = new workerCrypto.DigestStream("SHA-256");
    await stream.pipeTo(digestStream);
    return digestStream.digest;
  }
  return null;
}

function averageBitrate(sizeBytes: number, durationSeconds: number | null): number | null {
  if (durationSeconds == null || durationSeconds <= 0 || sizeBytes <= 0) return null;
  const bps = Math.round((sizeBytes * 8) / durationSeconds);
  if (bps <= 0 || bps > MAX_BITRATE) return null;
  return bps;
}

function containerFromFilename(filename: string | null): string | null {
  const match = filename?.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return null;
  const ext = match[1];
  if (ext === "mp4") return "m4a";
  if (
    ext === "mp3" ||
    ext === "m4a" ||
    ext === "m4b" ||
    ext === "wav" ||
    ext === "flac" ||
    ext === "aac" ||
    ext === "ogg" ||
    ext === "opus"
  ) {
    return ext;
  }
  return null;
}

function parseWav(bytes: Uint8Array, facts: MutableFacts): void {
  if (bytes.length < 44) return;
  if (!asciiEquals(bytes, 0, "RIFF") || !asciiEquals(bytes, 8, "WAVE")) return;
  facts.container = facts.container ?? "wav";

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const type = asciiAt(bytes, offset, 4);
    const size = readU32Le(bytes, offset + 4);
    const body = offset + 8;
    if (type === "fmt " && body + 16 <= bytes.length) {
      facts.channels = facts.channels ?? readU16Le(bytes, body + 2);
      facts.sampleRate = facts.sampleRate ?? readU32Le(bytes, body + 4);
      byteRate = readU32Le(bytes, body + 8);
      if (byteRate > 0) facts.bitrate = facts.bitrate ?? byteRate * 8;
    } else if (type === "data") {
      dataSize = size;
      break;
    }
    offset = body + size + (size % 2);
  }
  if (byteRate > 0 && dataSize > 0) {
    facts.durationSeconds = facts.durationSeconds ?? normalizeDurationSeconds(dataSize / byteRate);
  }
}

function parseFlac(bytes: Uint8Array, facts: MutableFacts): void {
  if (bytes.length < 42 || !asciiEquals(bytes, 0, "fLaC")) return;
  facts.container = facts.container ?? "flac";

  let offset = 4;
  while (offset + 4 <= bytes.length) {
    const isLast = (bytes[offset] & 0x80) !== 0;
    const type = bytes[offset] & 0x7f;
    const size = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const body = offset + 4;
    const end = Math.min(bytes.length, body + size);
    if (type === 0 && body + 18 <= bytes.length) {
      const packed = readU32Be(bytes, body + 10);
      const sampleRate = packed >>> 12;
      const channels = ((packed >>> 9) & 0x07) + 1;
      const totalHi = packed & 0x0f;
      const totalLo = readU32Be(bytes, body + 14);
      const totalSamples = totalHi * 0x1_0000_0000 + totalLo;
      facts.sampleRate = facts.sampleRate ?? sampleRate;
      facts.channels = facts.channels ?? channels;
      if (sampleRate > 0 && totalSamples > 0) {
        facts.durationSeconds = facts.durationSeconds ?? normalizeDurationSeconds(totalSamples / sampleRate);
      }
    } else if (type === 4) {
      parseVorbisComment(bytes.subarray(body, end), facts);
    } else if (type === 6) {
      const cover = parseFlacPicture(bytes.subarray(body, end));
      if (cover && !facts.cover) facts.cover = cover;
    }
    if (isLast || size < 0) break;
    offset = body + size;
  }
}

function parseVorbisComment(bytes: Uint8Array, facts: MutableFacts): void {
  if (bytes.length < 8) return;
  const vendorLen = readU32Le(bytes, 0);
  let offset = 4 + vendorLen;
  if (offset + 4 > bytes.length) return;
  const count = readU32Le(bytes, offset);
  offset += 4;
  for (let index = 0; index < count && offset + 4 <= bytes.length; index += 1) {
    const length = readU32Le(bytes, offset);
    offset += 4;
    if (offset + length > bytes.length) break;
    const text = utf8(bytes.subarray(offset, offset + length));
    offset += length;
    const eq = text.indexOf("=");
    if (eq <= 0) continue;
    const key = text.slice(0, eq).toUpperCase();
    const value = cleanText(text.slice(eq + 1));
    if (!value) continue;
    if (key === "ALBUM") facts.album = facts.album ?? value;
    else if (key === "ARTIST") facts.artist = facts.artist ?? value;
    else if (key === "NARRATOR" || key === "PERFORMER") facts.narrator = facts.narrator ?? value;
  }
}

function parseFlacPicture(bytes: Uint8Array): EmbeddedCover | null {
  if (bytes.length < 32) return null;
  let offset = 4;
  const mimeLen = readU32Be(bytes, offset);
  offset += 4;
  if (offset + mimeLen + 4 > bytes.length) return null;
  const mime = asciiAt(bytes, offset, mimeLen).toLowerCase();
  offset += mimeLen;
  const descLen = readU32Be(bytes, offset);
  offset += 4 + descLen + 16;
  if (offset + 4 > bytes.length) return null;
  const dataLen = readU32Be(bytes, offset);
  offset += 4;
  if (dataLen <= 0 || dataLen > MAX_COVER_BYTES || offset + dataLen > bytes.length) return null;
  return coverFrom(bytes.subarray(offset, offset + dataLen), mime);
}

function parseMp4(bytes: Uint8Array, facts: MutableFacts): void {
  walkBoxes(bytes, 0, bytes.length, facts, false);
  if (facts.durationSeconds == null) {
    const scanned = scanMvhd(bytes);
    if (scanned != null) facts.durationSeconds = scanned;
  }
}

function scanMvhd(bytes: Uint8Array): number | null {
  for (let index = 4; index + 8 <= bytes.length; index += 1) {
    if (!asciiEquals(bytes, index, "mvhd")) continue;
    const parsed = parseMvhd(bytes, index + 4, bytes.length);
    if (parsed != null) return parsed;
  }
  return null;
}

function walkBoxes(bytes: Uint8Array, start: number, end: number, facts: MutableFacts, inIlst: boolean): void {
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = readU32Be(bytes, offset);
    const type = asciiAt(bytes, offset + 4, 4);
    let header = 8;
    let boxSize = size32;
    if (size32 === 1) {
      if (offset + 16 > end) break;
      const size64 = readU32Be(bytes, offset + 8) * 0x1_0000_0000 + readU32Be(bytes, offset + 12);
      if (size64 > Number.MAX_SAFE_INTEGER) break;
      boxSize = size64;
      header = 16;
    } else if (size32 === 0) {
      boxSize = end - offset;
    }
    if (boxSize < header) break;
    const bodyStart = offset + header;
    const bodyEnd = Math.min(end, offset + boxSize);
    if (bodyEnd > end && size32 !== 0) break;

    if (type === "ftyp" && bodyStart + 4 <= bodyEnd) {
      facts.container = facts.container ?? containerFromFtyp(bytes, bodyStart, bodyEnd);
    } else if (type === "mvhd") {
      const duration = parseMvhd(bytes, bodyStart, bodyEnd);
      if (duration != null) facts.durationSeconds = facts.durationSeconds ?? duration;
    } else if (type === "mdhd") {
      parseMdhd(bytes, bodyStart, bodyEnd, facts);
    } else if (type === "mp4a" || type === "Opus" || type === "fLaC") {
      parseAudioSampleEntry(bytes, bodyStart, bodyEnd, facts);
      walkBoxes(bytes, bodyStart + 28, bodyEnd, facts, false);
    } else if (type === "esds") {
      parseEsds(bytes, bodyStart, bodyEnd, facts);
    } else if (type === "meta") {
      walkBoxes(bytes, bodyStart + 4, bodyEnd, facts, inIlst);
    } else if (type === "ilst") {
      walkBoxes(bytes, bodyStart, bodyEnd, facts, true);
    } else if (inIlst) {
      parseIlstTag(bytes, offset + 4, bodyStart, bodyEnd, facts);
    } else if (
      type === "moov" ||
      type === "trak" ||
      type === "mdia" ||
      type === "minf" ||
      type === "stbl" ||
      type === "stsd" ||
      type === "udta"
    ) {
      const nestedStart = type === "stsd" ? bodyStart + 8 : bodyStart;
      walkBoxes(bytes, nestedStart, bodyEnd, facts, false);
    }

    if (boxSize <= 0) break;
    offset += boxSize;
  }
}

function containerFromFtyp(bytes: Uint8Array, start: number, end: number): string {
  const brands: string[] = [];
  for (let offset = start; offset + 4 <= end; offset += 4) {
    brands.push(asciiAt(bytes, offset, 4));
  }
  if (brands.some((brand) => brand === "M4B " || brand === "M4B")) return "m4b";
  if (brands.some((brand) => brand === "M4A " || brand === "M4A")) return "m4a";
  return "m4a";
}

function parseMvhd(bytes: Uint8Array, start: number, end: number): number | null {
  if (start + 24 > end) return null;
  const version = bytes[start];
  if (version === 0) {
    const timescale = readU32Be(bytes, start + 12);
    const duration = readU32Be(bytes, start + 16);
    if (timescale <= 0) return null;
    return normalizeDurationSeconds(duration / timescale);
  }
  if (version === 1) {
    if (start + 32 > end) return null;
    const timescale = readU32Be(bytes, start + 20);
    const duration = readU32Be(bytes, start + 24) * 0x1_0000_0000 + readU32Be(bytes, start + 28);
    if (timescale <= 0) return null;
    return normalizeDurationSeconds(duration / timescale);
  }
  return null;
}

function parseMdhd(bytes: Uint8Array, start: number, end: number, facts: MutableFacts): void {
  if (start + 20 > end) return;
  const version = bytes[start];
  const timescale = version === 1 ? (start + 24 <= end ? readU32Be(bytes, start + 20) : 0) : readU32Be(bytes, start + 12);
  if (timescale >= 8000 && timescale <= 192000) {
    facts.sampleRate = facts.sampleRate ?? timescale;
  }
}

function parseAudioSampleEntry(bytes: Uint8Array, start: number, end: number, facts: MutableFacts): void {
  if (start + 20 > end) return;
  const channels = readU16Be(bytes, start + 8);
  const sampleRate = readU32Be(bytes, start + 16) >>> 16;
  if (channels > 0 && channels < 16) facts.channels = facts.channels ?? channels;
  if (sampleRate >= 8000 && sampleRate <= 192000) facts.sampleRate = facts.sampleRate ?? sampleRate;
}

function parseEsds(bytes: Uint8Array, start: number, end: number, facts: MutableFacts): void {
  for (let offset = start; offset + 8 < end; offset += 1) {
    if (bytes[offset] !== 0x04) continue;
    const length = readDescriptorLength(bytes, offset + 1, end);
    if (!length) continue;
    const body = length.offset;
    if (body + 13 > end) continue;
    const avgBitrate = readU32Be(bytes, body + 9);
    if (avgBitrate > 0 && avgBitrate <= MAX_BITRATE) {
      facts.bitrate = facts.bitrate ?? avgBitrate;
      return;
    }
  }
}

function readDescriptorLength(
  bytes: Uint8Array,
  offset: number,
  end: number,
): { offset: number; length: number } | null {
  let length = 0;
  let cursor = offset;
  for (let index = 0; index < 4 && cursor < end; index += 1) {
    const value = bytes[cursor];
    cursor += 1;
    length = (length << 7) | (value & 0x7f);
    if ((value & 0x80) === 0) return { offset: cursor, length };
  }
  return null;
}

function parseIlstTag(
  bytes: Uint8Array,
  typeAt: number,
  bodyStart: number,
  bodyEnd: number,
  facts: MutableFacts,
): void {
  const type = bytes.subarray(typeAt, typeAt + 4);
  if (asciiEquals(type, 0, "----")) {
    parseFreeformTag(bytes, bodyStart, bodyEnd, facts);
    return;
  }

  const data = findDataAtom(bytes, bodyStart, bodyEnd);
  if (!data) return;
  const kind = data.type;
  if (kind === 13 || kind === 14) {
    if (!facts.cover) facts.cover = coverFrom(data.payload, kind === 14 ? "image/png" : "image/jpeg");
    return;
  }
  const text = kind === 1 || kind === 0 ? utf8(data.payload) : kind === 2 ? utf16be(data.payload) : null;
  const value = cleanText(text);
  if (!value) return;

  if (bytesEqual(type, [0xa9, 0x61, 0x6c, 0x62])) facts.album = facts.album ?? value;
  else if (bytesEqual(type, [0xa9, 0x41, 0x52, 0x54]) || bytesEqual(type, [0xa9, 0x61, 0x72, 0x74])) {
    facts.artist = facts.artist ?? value;
  } else if (asciiEquals(type, 0, "aART")) facts.artist = facts.artist ?? value;
  else if (bytesEqual(type, [0xa9, 0x6e, 0x72, 0x74])) facts.narrator = facts.narrator ?? value;
  else if (bytesEqual(type, [0xa9, 0x77, 0x72, 0x74])) facts.narrator = facts.narrator ?? value;
}

function parseFreeformTag(bytes: Uint8Array, start: number, end: number, facts: MutableFacts): void {
  let name = "";
  let value = "";
  let offset = start;
  while (offset + 8 <= end) {
    const size = readU32Be(bytes, offset);
    const type = asciiAt(bytes, offset + 4, 4);
    if (size < 8 || offset + size > end) break;
    const data = findDataAtom(bytes, offset + 8, offset + size);
    const raw = bytes.subarray(offset + 8, offset + size);
    const text = data ? utf8(data.payload) : utf8(raw.subarray(Math.min(4, raw.length)));
    if (type === "name") name = text;
    if (type === "data") value = text;
    offset += size;
  }
  const key = name.replace(/^com\.apple\.iTunes:/, "").trim().toUpperCase();
  const cleaned = cleanText(value);
  if (!cleaned) return;
  if (key === "NARRATOR" || key === "NRT") facts.narrator = facts.narrator ?? cleaned;
  if (key === "AUTHOR" || key === "ARTIST") facts.artist = facts.artist ?? cleaned;
  if (key === "ALBUM") facts.album = facts.album ?? cleaned;
}

function findDataAtom(
  bytes: Uint8Array,
  start: number,
  end: number,
): { type: number; payload: Uint8Array } | null {
  let offset = start;
  while (offset + 16 <= end) {
    const size = readU32Be(bytes, offset);
    if (size < 16 || offset + 8 > end) break;
    if (asciiEquals(bytes, offset + 4, "data") && offset + size <= end) {
      return {
        type: readU32Be(bytes, offset + 8),
        payload: bytes.subarray(offset + 16, offset + size),
      };
    }
    if (size < 8) break;
    offset += size;
  }
  return null;
}

function parseMp3Stream(bytes: Uint8Array, facts: MutableFacts): void {
  const frame = findMpegFrame(bytes, skipId3v2(bytes));
  if (!frame) return;
  facts.container = facts.container ?? "mp3";
  facts.sampleRate = facts.sampleRate ?? frame.sampleRate;
  facts.channels = facts.channels ?? (frame.mono ? 1 : 2);
  facts.bitrate = facts.bitrate ?? frame.bitrate;
  const xing = findXing(bytes, frame);
  if (xing) {
    facts.vbr = true;
    facts.durationSeconds =
      facts.durationSeconds ?? normalizeDurationSeconds((xing.frames * frame.samplesPerFrame) / frame.sampleRate);
  }
}

function parseId3(bytes: Uint8Array, facts: MutableFacts): void {
  if (bytes.length < 10 || !asciiEquals(bytes, 0, "ID3")) return;
  const version = bytes[3];
  if (version < 2 || version > 4) return;
  const flags = bytes[5];
  const size = synchsafe(bytes, 6);
  const end = Math.min(bytes.length, 10 + size);
  let body = bytes.subarray(10, end);
  if ((flags & 0x80) !== 0 && version <= 3) body = unsynchronise(body);
  let offset = 0;
  if (version >= 3 && (flags & 0x40) !== 0 && body.length >= 4) {
    const extSize = version === 4 ? synchsafe(body, 0) : readU32Be(body, 0);
    offset = version === 4 ? extSize : Math.min(body.length, 4 + extSize);
  }

  const txxxNarrator: string[] = [];
  const composer: string[] = [];

  while (offset + (version === 2 ? 6 : 10) <= body.length) {
    if (version === 2) {
      const id = asciiAt(body, offset, 3);
      const frameSize = (body[offset + 3] << 16) | (body[offset + 4] << 8) | body[offset + 5];
      const payloadStart = offset + 6;
      const payloadEnd = payloadStart + frameSize;
      if (!id.replace(/\0/g, "") || frameSize < 1 || payloadEnd > body.length) break;
      takeId3Frame(id, body.subarray(payloadStart, payloadEnd), facts, txxxNarrator, composer);
      offset = payloadEnd;
      continue;
    }

    const id = asciiAt(body, offset, 4);
    const frameSize = version === 4 ? synchsafe(body, offset + 4) : readU32Be(body, offset + 4);
    const frameFlags = readU16Be(body, offset + 8);
    let payloadStart = offset + 10;
    const payloadEnd = payloadStart + frameSize;
    if (!id.replace(/\0/g, "") || frameSize < 1 || payloadEnd > body.length) break;
    if (version === 4 && (frameFlags & 0x0001) !== 0) payloadStart += 4;
    if ((frameFlags & 0x0002) !== 0 || (version === 4 && (frameFlags & 0x0002) !== 0)) {
      takeId3Frame(
        id,
        unsynchronise(body.subarray(payloadStart, payloadEnd)),
        facts,
        txxxNarrator,
        composer,
      );
    } else {
      takeId3Frame(id, body.subarray(payloadStart, payloadEnd), facts, txxxNarrator, composer);
    }
    offset = payloadEnd;
  }

  if (!facts.narrator && txxxNarrator[0]) facts.narrator = txxxNarrator[0];
  if (!facts.narrator && composer[0] && composer[0] !== facts.artist) facts.narrator = composer[0];
}

function takeId3Frame(
  id: string,
  payload: Uint8Array,
  facts: MutableFacts,
  txxxNarrator: string[],
  composer: string[],
): void {
  if (id === "TAL" || id === "TALB") facts.album = facts.album ?? decodeId3Text(payload);
  else if (id === "TP1" || id === "TPE1") facts.artist = facts.artist ?? decodeId3Text(payload);
  else if (id === "TP2" || id === "TPE2") facts.artist = facts.artist ?? decodeId3Text(payload);
  else if (id === "TCM" || id === "TCOM") {
    const value = decodeId3Text(payload);
    if (value) composer.push(value);
  } else if (id === "TXX" || id === "TXXX") takeTxxx(payload, txxxNarrator, facts);
  else if (id === "PIC" || id === "APIC") {
    const cover = id === "PIC" ? parsePic(payload) : parseApic(payload);
    if (cover && !facts.cover) facts.cover = cover;
  }
}

function takeTxxx(payload: Uint8Array, txxxNarrator: string[], facts: MutableFacts): void {
  if (payload.length < 2) return;
  const encoding = payload[0];
  const rest = payload.subarray(1);
  const { first, second } = splitEncoded(rest, encoding);
  const key = first.trim().toUpperCase();
  const value = cleanText(second);
  if (!value) return;
  if (key === "NARRATOR" || key === "NRT") txxxNarrator.push(value);
  if (key === "AUTHOR" && !facts.artist) facts.artist = value;
  if (key === "ALBUM" && !facts.album) facts.album = value;
}

function parseApic(payload: Uint8Array): EmbeddedCover | null {
  if (payload.length < 4) return null;
  const encoding = payload[0];
  let offset = 1;
  const mimeEnd = indexOfByte(payload, 0, offset);
  if (mimeEnd < 0) return null;
  const mime = asciiAt(payload, offset, mimeEnd - offset).toLowerCase();
  offset = mimeEnd + 1;
  if (offset >= payload.length) return null;
  offset += 1;
  const description = readEncodedTerminated(payload, offset, encoding);
  offset = description.next;
  if (offset >= payload.length) return null;
  return coverFrom(payload.subarray(offset), mime);
}

function parsePic(payload: Uint8Array): EmbeddedCover | null {
  if (payload.length < 6) return null;
  const encoding = payload[0];
  const format = asciiAt(payload, 1, 3).toUpperCase();
  const description = readEncodedTerminated(payload, 5, encoding);
  const mime = format === "PNG" ? "image/png" : "image/jpeg";
  return coverFrom(payload.subarray(description.next), mime);
}

function decodeId3Text(payload: Uint8Array): string | null {
  if (payload.length < 2) return cleanText(utf8(payload));
  return cleanText(decodeEncoded(payload.subarray(1), payload[0]));
}

function decodeEncoded(bytes: Uint8Array, encoding: number): string {
  if (encoding === 0) return latin1(bytes).replace(/\0+$/g, "");
  if (encoding === 3) return utf8(bytes).replace(/\0+$/g, "");
  if (encoding === 1) return utf16WithBom(bytes).replace(/\0+$/g, "");
  if (encoding === 2) return utf16be(bytes).replace(/\0+$/g, "");
  return utf8(bytes).replace(/\0+$/g, "");
}

function splitEncoded(bytes: Uint8Array, encoding: number): { first: string; second: string } {
  const terminated = readEncodedTerminated(bytes, 0, encoding);
  return {
    first: terminated.text,
    second: decodeEncoded(bytes.subarray(terminated.next), encoding),
  };
}

function readEncodedTerminated(
  bytes: Uint8Array,
  start: number,
  encoding: number,
): { text: string; next: number } {
  const wide = encoding === 1 || encoding === 2;
  if (wide) {
    for (let index = start; index + 1 < bytes.length; index += 2) {
      if (bytes[index] === 0 && bytes[index + 1] === 0) {
        return { text: decodeEncoded(bytes.subarray(start, index), encoding), next: index + 2 };
      }
    }
    return { text: decodeEncoded(bytes.subarray(start), encoding), next: bytes.length };
  }
  const zero = indexOfByte(bytes, 0, start);
  if (zero < 0) return { text: decodeEncoded(bytes.subarray(start), encoding), next: bytes.length };
  return { text: decodeEncoded(bytes.subarray(start, zero), encoding), next: zero + 1 };
}

function skipId3v2(bytes: Uint8Array): number {
  return id3TagLength(bytes);
}

function id3TagLength(bytes: Uint8Array): number {
  if (bytes.length < 10 || !asciiEquals(bytes, 0, "ID3")) return 0;
  const size = synchsafe(bytes, 6);
  const footer = bytes[5] & 0x10 ? 10 : 0;
  return Math.min(bytes.length, 10 + size + footer);
}

function findMpegFrame(bytes: Uint8Array, start: number): {
  offset: number;
  sampleRate: number;
  samplesPerFrame: number;
  sideInfo: number;
  bitrate: number | null;
  mono: boolean;
} | null {
  for (let offset = start; offset + 4 < bytes.length; offset += 1) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (bytes[offset + 1] >> 3) & 0x03;
    const layerBits = (bytes[offset + 1] >> 1) & 0x03;
    const bitrateBits = (bytes[offset + 2] >> 4) & 0x0f;
    const rateBits = (bytes[offset + 2] >> 2) & 0x03;
    const channelBits = (bytes[offset + 3] >> 6) & 0x03;
    if (versionBits === 1 || layerBits === 0 || rateBits === 3 || bitrateBits === 0 || bitrateBits === 15) {
      continue;
    }

    const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
    const layer = 4 - layerBits;
    const rates =
      version === 1 ? [44100, 48000, 32000] : version === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
    const sampleRate = rates[rateBits];
    const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : version === 1 ? 1152 : 576;
    const mono = channelBits === 3;
    const sideInfo = version === 1 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const bitrateKbps = mpegBitrateKbps(version, layer, bitrateBits);
    return {
      offset,
      sampleRate,
      samplesPerFrame,
      sideInfo,
      bitrate: bitrateKbps ? bitrateKbps * 1000 : null,
      mono,
    };
  }
  return null;
}

function mpegBitrateKbps(version: number, layer: number, index: number): number | null {
  const table =
    version === 1
      ? layer === 1
        ? [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448]
        : layer === 2
          ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]
          : [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : layer === 1
        ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  return table[index] ?? null;
}

function findXing(
  bytes: Uint8Array,
  frame: { offset: number; sideInfo: number },
): { frames: number } | null {
  const tagAt = frame.offset + 4 + frame.sideInfo;
  if (tagAt + 8 > bytes.length) return null;
  if (!asciiEquals(bytes, tagAt, "Xing") && !asciiEquals(bytes, tagAt, "Info")) return null;
  const flags = readU32Be(bytes, tagAt + 4);
  if ((flags & 0x01) === 0 || tagAt + 12 > bytes.length) return null;
  const frames = readU32Be(bytes, tagAt + 8);
  return frames > 0 ? { frames } : null;
}

function coverFrom(bytes: Uint8Array, mime: string): EmbeddedCover | null {
  if (bytes.length < 24 || bytes.length > MAX_COVER_BYTES) return null;
  if (mime === "-->") return null;
  const contentType =
    mime.includes("png") || bytesEqual(bytes.subarray(0, 8), [137, 80, 78, 71, 13, 10, 26, 10])
      ? "image/png"
      : mime.includes("webp")
        ? "image/webp"
        : mime.includes("gif")
          ? "image/gif"
          : bytes[0] === 0xff && bytes[1] === 0xd8
            ? "image/jpeg"
            : mime.startsWith("image/")
              ? mime
              : null;
  if (!contentType) return null;
  return { bytes: bytes.slice(), contentType };
}

function unsynchronise(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    output[length] = bytes[index];
    length += 1;
    if (bytes[index] === 0xff && bytes[index + 1] === 0x00) index += 1;
  }
  return output.subarray(0, length);
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\0/g, " ").replace(/\s+/g, " ").trim();
  return trimmed.length > 0 && trimmed.length <= 500 ? trimmed : null;
}

function asciiEquals(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function bytesEqual(bytes: Uint8Array, expected: number[]): boolean {
  if (bytes.length < expected.length) return false;
  return expected.every((value, index) => bytes[index] === value);
}

function latin1(bytes: Uint8Array): string {
  return new TextDecoder("iso-8859-1").decode(bytes);
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function utf16be(bytes: Uint8Array): string {
  return new TextDecoder("utf-16be").decode(bytes);
}

function utf16WithBom(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  return utf16be(bytes);
}

function synchsafe(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function indexOfByte(bytes: Uint8Array, value: number, start: number): number {
  for (let index = start; index < bytes.length; index += 1) {
    if (bytes[index] === value) return index;
  }
  return -1;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readU16Be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32Be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function readU32Le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
  );
}
