const TEXT_DOCUMENT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'log',
  'yaml',
  'yml'
]);

const MARKUP_DOCUMENT_EXTENSIONS = new Set([
  'html',
  'htm',
  'xml'
]);

const RTF_DOCUMENT_EXTENSIONS = new Set([
  'rtf'
]);

const DOCX_DOCUMENT_EXTENSIONS = new Set([
  'docx'
]);

const DOCX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

const DOCX_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const DOCX_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const DOCX_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const DOCX_MAX_COMMENT_LENGTH = 0xffff;

const XML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

type ZipEntry = {
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
  name: string;
};

export const DOCUMENT_UPLOAD_ACCEPT = [
  'application/pdf',
  '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docx',
  'text/plain',
  '.txt',
  'text/markdown',
  '.md',
  '.markdown',
  'text/csv',
  '.csv',
  'application/json',
  '.json',
  'text/html',
  '.html',
  '.htm',
  'application/xml',
  'text/xml',
  '.xml',
  'application/rtf',
  'text/rtf',
  '.rtf',
  '.log',
  '.yaml',
  '.yml'
].join(',');

export const getFileExtension = (fileName: string) => {
  const parts = fileName.toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() ?? '' : '';
};

const normalizeImportedText = (value: string) =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const decodeXmlEntities = (value: string) =>
  value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    const loweredEntity = entity.toLowerCase();

    if (loweredEntity.startsWith('#x')) {
      const code = Number.parseInt(loweredEntity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }

    if (loweredEntity.startsWith('#')) {
      const code = Number.parseInt(loweredEntity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }

    return XML_ENTITY_MAP[loweredEntity] ?? '';
  });

const stripMarkupToText = (value: string) =>
  normalizeImportedText(
    decodeXmlEntities(
      value
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(article|aside|blockquote|div|footer|h[1-6]|header|li|main|nav|ol|p|section|table|tr|ul)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
  );

const stripRtfToText = (value: string) =>
  normalizeImportedText(
    decodeXmlEntities(
      value
        .replace(/\\par[d]?/gi, '\n')
        .replace(/\\line/gi, '\n')
        .replace(/\\tab/gi, '\t')
        .replace(/\\u(-?\d+)\??/g, (_match, rawCodePoint: string) => {
          const parsed = Number.parseInt(rawCodePoint, 10);
          const normalized = parsed < 0 ? parsed + 65536 : parsed;
          return Number.isFinite(normalized) ? String.fromCodePoint(normalized) : '';
        })
        .replace(/\\'([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
        .replace(/\\[a-z]+-?\d* ?/gi, '')
        .replace(/[{}]/g, ' ')
    )
  );

const readZipUint16 = (view: DataView, offset: number) =>
  view.getUint16(offset, true);

const readZipUint32 = (view: DataView, offset: number) =>
  view.getUint32(offset, true);

const findEndOfCentralDirectory = (view: DataView) => {
  const minOffset = Math.max(0, view.byteLength - DOCX_MAX_COMMENT_LENGTH - 22);

  for (let offset = view.byteLength - 22; offset >= minOffset; offset--) {
    if (readZipUint32(view, offset) === DOCX_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  throw new Error('DOCX-filen verkar vara skadad.');
};

const decodeZipEntryName = (buffer: ArrayBuffer, offset: number, byteLength: number) =>
  new TextDecoder('utf-8').decode(new Uint8Array(buffer, offset, byteLength));

const readZipEntries = (buffer: ArrayBuffer) => {
  const view = new DataView(buffer);
  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(view);
  const entryCount = readZipUint16(view, endOfCentralDirectoryOffset + 10);
  const centralDirectoryOffset = readZipUint32(view, endOfCentralDirectoryOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
    if (readZipUint32(view, offset) !== DOCX_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('DOCX-filen innehåller en ogiltig katalog.');
    }

    const compressionMethod = readZipUint16(view, offset + 10);
    const compressedSize = readZipUint32(view, offset + 20);
    const fileNameLength = readZipUint16(view, offset + 28);
    const extraFieldLength = readZipUint16(view, offset + 30);
    const fileCommentLength = readZipUint16(view, offset + 32);
    const localHeaderOffset = readZipUint32(view, offset + 42);
    const name = decodeZipEntryName(buffer, offset + 46, fileNameLength);

    entries.push({
      compressionMethod,
      compressedSize,
      localHeaderOffset,
      name,
    });

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
};

const decompressDeflateRaw = async (compressedData: Uint8Array) => {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Den här webbläsaren kan inte läsa DOCX-filer ännu.');
  }

  const stream = new Blob([compressedData]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
};

const readZipEntryData = async (buffer: ArrayBuffer, entry: ZipEntry) => {
  const view = new DataView(buffer);
  const localOffset = entry.localHeaderOffset;

  if (readZipUint32(view, localOffset) !== DOCX_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error('DOCX-filen innehåller en ogiltig filpost.');
  }

  const fileNameLength = readZipUint16(view, localOffset + 26);
  const extraFieldLength = readZipUint16(view, localOffset + 28);
  const dataOffset = localOffset + 30 + fileNameLength + extraFieldLength;
  const compressedData = new Uint8Array(buffer, dataOffset, entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return compressedData;
  }

  if (entry.compressionMethod === 8) {
    return decompressDeflateRaw(compressedData);
  }

  throw new Error('DOCX-filen använder en komprimering som inte stöds.');
};

const DOCX_TEXT_ENTRY_PRIORITY = [
  'word/document.xml',
  'word/footnotes.xml',
  'word/endnotes.xml',
];

const DOCX_TEXT_ENTRY_PATTERN = /^word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml$/i;

const sortDocxTextEntries = (a: ZipEntry, b: ZipEntry) => {
  const aPriority = DOCX_TEXT_ENTRY_PRIORITY.indexOf(a.name);
  const bPriority = DOCX_TEXT_ENTRY_PRIORITY.indexOf(b.name);

  if (aPriority !== -1 || bPriority !== -1) {
    if (aPriority === -1) return 1;
    if (bPriority === -1) return -1;
    return aPriority - bPriority;
  }

  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
};

const extractWordprocessingXmlText = (xml: string) =>
  normalizeImportedText(
    decodeXmlEntities(
      xml
        .replace(/<w:tab\b[^>]*\/>/gi, '\t')
        .replace(/<w:(?:br|cr)\b[^>]*\/>/gi, '\n')
        .replace(/<\/w:p>/gi, '\n')
        .replace(/<\/w:tr>/gi, '\n')
        .replace(/<[^>]+>/g, '')
    )
  );

const extractTextFromDocx = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const entries = readZipEntries(buffer)
    .filter(entry => DOCX_TEXT_ENTRY_PATTERN.test(entry.name))
    .sort(sortDocxTextEntries);

  if (entries.length === 0) {
    throw new Error('DOCX-filen innehåller ingen läsbar text.');
  }

  const sections: string[] = [];

  for (const entry of entries) {
    const entryData = await readZipEntryData(buffer, entry);
    const xml = new TextDecoder('utf-8').decode(entryData);
    const extractedText = extractWordprocessingXmlText(xml);
    if (extractedText) {
      sections.push(extractedText);
    }
  }

  return normalizeImportedText(sections.join('\n\n'));
};

const streamLocalPlainTextFile = async (
  file: File,
  onChunk: (textChunk: string) => void
) => {
  if (typeof file.stream === 'function') {
    const reader = file.stream().getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      const textChunk = decoder.decode(value, { stream: !done });
      if (textChunk) {
        onChunk(textChunk);
      }
      if (done) {
        break;
      }
    }

    const trailingText = decoder.decode();
    if (trailingText) {
      onChunk(trailingText);
    }
    return;
  }

  onChunk(await file.text());
};

export const isDocxFile = (file: File) => {
  const extension = getFileExtension(file.name);
  return DOCX_DOCUMENT_EXTENSIONS.has(extension) || DOCX_MIME_TYPES.has(file.type);
};

const isMarkupDocumentFile = (file: File) =>
  MARKUP_DOCUMENT_EXTENSIONS.has(getFileExtension(file.name));

const isRtfDocumentFile = (file: File) =>
  RTF_DOCUMENT_EXTENSIONS.has(getFileExtension(file.name)) ||
  file.type === 'application/rtf' ||
  file.type === 'text/rtf';

export const isTextDocumentFile = (file: File) => {
  const extension = getFileExtension(file.name);
  return (
    isDocxFile(file) ||
    isRtfDocumentFile(file) ||
    isMarkupDocumentFile(file) ||
    file.type.startsWith('text/') ||
    TEXT_DOCUMENT_EXTENSIONS.has(extension)
  );
};

export const streamLocalDocumentText = async (
  file: File,
  onChunk: (textChunk: string) => void
) => {
  if (isDocxFile(file)) {
    const text = await extractTextFromDocx(file);
    if (text) {
      onChunk(text);
    }
    return;
  }

  if (isRtfDocumentFile(file)) {
    const text = stripRtfToText(await file.text());
    if (text) {
      onChunk(text);
    }
    return;
  }

  if (isMarkupDocumentFile(file)) {
    const text = stripMarkupToText(await file.text());
    if (text) {
      onChunk(text);
    }
    return;
  }

  await streamLocalPlainTextFile(file, onChunk);
};
