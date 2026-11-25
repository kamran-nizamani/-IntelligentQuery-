import { chunkProseText, chunkSourceCode, type DocumentChunkSpec } from "../chunking/chunker";

export interface ExtractedFileResult {
  fileName: string;
  fileSize: number;
  fileType: string;
  contentKind: "document" | "code";
  rawText: string;
  chunks: DocumentChunkSpec[];
}

const CODE_EXTENSIONS = new Set([
  "py",
  "java",
  "js",
  "jsx",
  "ts",
  "tsx",
  "c",
  "cpp",
  "h",
  "cs",
  "go",
  "rs",
  "php",
  "rb",
  "sql",
  "html",
  "css",
  "sh",
]);

const LANGUAGE_MAP: Record<string, string> = {
  py: "python",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sql: "sql",
  html: "html",
  css: "css",
  sh: "shell",
  rb: "ruby",
  go: "go",
  rs: "rust",
  cpp: "cpp",
  c: "c",
  cs: "csharp",
};

const MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024; // Guard against decompression bombs

export function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

export function isCodeFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return CODE_EXTENSIONS.has(ext);
}

/**
 * Decompresses a deflate/zlib byte slice using the Web Streams DecompressionStream API
 * (works natively in modern browsers and Node 18+ without CommonJS require("pako")).
 */
async function inflateWithStream(
  bytes: Uint8Array,
  format: "deflate" | "deflate-raw"
): Promise<string | null> {
  if (typeof DecompressionStream === "undefined") {
    return null;
  }
  try {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const writePromise = writer
      .write(copy)
      .then(() => writer.close())
      .catch(() => undefined);
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_DECOMPRESSED_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    }
    await writePromise.catch(() => undefined);

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("latin1").decode(merged);
  } catch {
    return null;
  }
}

async function decompressDeflate(bytes: Uint8Array): Promise<string | null> {
  const zlibResult = await inflateWithStream(bytes, "deflate");
  if (zlibResult !== null) return zlibResult;
  return inflateWithStream(bytes, "deflate-raw");
}

function unescapePdfLiteral(raw: string): string {
  return raw
    .replace(/\\([nrtbf()\\])/g, (_, c: string) => {
      if (c === "n") return "\n";
      if (c === "t") return "\t";
      if (c === "r") return "\r";
      if (c === "b") return "\b";
      if (c === "f") return "\f";
      return c;
    })
    .trim();
}

/**
 * Balanced-parenthesis and hex-string scanner for PDF text blocks.
 * Properly handles escaped parentheses (`\(`, `\)`) and nested parentheses.
 */
function scanPdfTextTokens(block: string): string[] {
  const words: string[] = [];
  let i = 0;

  while (i < block.length) {
    const ch = block[i];
    if (ch === "(") {
      let depth = 1;
      let j = i + 1;
      let buf = "";
      while (j < block.length && depth > 0) {
        const cur = block[j];
        if (cur === "\\" && j + 1 < block.length) {
          buf += cur + block[j + 1];
          j += 2;
          continue;
        }
        if (cur === "(") {
          depth++;
          buf += cur;
        } else if (cur === ")") {
          depth--;
          if (depth > 0) buf += cur;
        } else {
          buf += cur;
        }
        j++;
      }
      const unescaped = unescapePdfLiteral(buf);
      if (unescaped) words.push(unescaped);
      i = j;
    } else if (ch === "<" && block[i + 1] !== "<") {
      const closeIdx = block.indexOf(">", i + 1);
      if (closeIdx === -1) break;
      const hex = block.slice(i + 1, closeIdx).replace(/\s+/g, "");
      if (/^[0-9a-fA-F]+$/.test(hex) && hex.length >= 2) {
        let str = "";
        for (let k = 0; k + 1 < hex.length; k += 2) {
          str += String.fromCharCode(parseInt(hex.substring(k, k + 2), 16));
        }
        if (str.trim()) words.push(str.trim());
      }
      i = closeIdx + 1;
    } else {
      i++;
    }
  }

  return words;
}

/**
 * Parses text tokens from a decompressed PDF content stream.
 * Handles BT...ET blocks, (text) Tj, [(t1) 10 (t2)] TJ, and hex string <hex> Tj.
 */
function parsePdfContentStream(streamContent: string): string {
  const textSegments: string[] = [];

  const btRegex = /BT\s+([\s\S]*?)\s+ET/g;
  let btMatch: RegExpExecArray | null;

  while ((btMatch = btRegex.exec(streamContent)) !== null) {
    const blockWords = scanPdfTextTokens(btMatch[1]);
    if (blockWords.length > 0) {
      textSegments.push(blockWords.join(" "));
    }
  }

  if (textSegments.length === 0) {
    const standaloneWords = scanPdfTextTokens(streamContent)
      .map((w) => w.replace(/[^\x20-\x7E\r\n\t]/g, " ").trim())
      .filter((w) => w.length > 1);
    if (standaloneWords.length > 0) {
      textSegments.push(standaloneWords.join(" "));
    }
  }

  return textSegments.join("\n");
}

/**
 * Extracts raw text from binary PDF data, handling FlateDecode compression,
 * uncompressed text streams, and fallback tokenization.
 */
export async function extractBasicPdfText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const streamMarker = new Uint8Array([115, 116, 114, 101, 97, 109]); // "stream"
  const endMarker = new Uint8Array([101, 110, 100, 115, 116, 114, 101, 97, 109]); // "endstream"
  const extractedParts: string[] = [];

  let pos = 0;
  while (pos < bytes.length) {
    let streamIdx = -1;
    for (let i = pos; i <= bytes.length - 6; i++) {
      if (
        bytes[i] === streamMarker[0] &&
        bytes[i + 1] === streamMarker[1] &&
        bytes[i + 2] === streamMarker[2] &&
        bytes[i + 3] === streamMarker[3] &&
        bytes[i + 4] === streamMarker[4] &&
        bytes[i + 5] === streamMarker[5]
      ) {
        streamIdx = i;
        break;
      }
    }
    if (streamIdx === -1) break;

    let dataStart = streamIdx + 6;
    if (bytes[dataStart] === 0x0d && bytes[dataStart + 1] === 0x0a) {
      dataStart += 2;
    } else if (bytes[dataStart] === 0x0a || bytes[dataStart] === 0x0d) {
      dataStart += 1;
    }

    let endIdx = -1;
    for (let i = dataStart; i <= bytes.length - 9; i++) {
      if (
        bytes[i] === endMarker[0] &&
        bytes[i + 1] === endMarker[1] &&
        bytes[i + 2] === endMarker[2] &&
        bytes[i + 3] === endMarker[3] &&
        bytes[i + 4] === endMarker[4] &&
        bytes[i + 5] === endMarker[5] &&
        bytes[i + 6] === endMarker[6] &&
        bytes[i + 7] === endMarker[7] &&
        bytes[i + 8] === endMarker[8]
      ) {
        endIdx = i;
        break;
      }
    }
    if (endIdx === -1) break;

    let dataEnd = endIdx;
    if (bytes[dataEnd - 1] === 0x0a) dataEnd--;
    if (bytes[dataEnd - 1] === 0x0d) dataEnd--;

    if (dataEnd > dataStart) {
      const streamSlice = bytes.subarray(dataStart, dataEnd);
      const decompressed = await decompressDeflate(streamSlice);
      if (decompressed) {
        const textFromStream = parsePdfContentStream(decompressed);
        if (textFromStream.length > 5) {
          extractedParts.push(textFromStream);
        }
      } else {
        const rawString = new TextDecoder("latin1").decode(streamSlice);
        const textFromStream = parsePdfContentStream(rawString);
        if (textFromStream.length > 5) {
          extractedParts.push(textFromStream);
        }
      }
    }

    pos = endIdx + 9;
  }

  if (extractedParts.length > 0) {
    return extractedParts.join("\n\n");
  }

  const fullText = new TextDecoder("latin1").decode(buffer);
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;
  const parts: string[] = [];

  while ((match = streamRegex.exec(fullText)) !== null) {
    const raw = match[1];
    const clean = raw.replace(/[^\x20-\x7E\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
    if (clean.length > 20) {
      parts.push(clean);
    }
  }

  if (parts.length > 0) {
    return parts.join("\n\n");
  }

  return fullText.replace(/[^\x20-\x7E\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Extracts text and chunks from a browser File object.
 */
export async function extractFileInBrowser(file: File): Promise<ExtractedFileResult> {
  const ext = getFileExtension(file.name);
  const isCode = isCodeFile(file.name);
  const contentKind = isCode ? "code" : "document";
  let rawText = "";

  if (ext === "docx") {
    const mammothModule = await import("mammoth");
    const mammoth = mammothModule.default ?? mammothModule;
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    rawText = result.value || "";
  } else if (ext === "pdf") {
    const arrayBuffer = await file.arrayBuffer();
    rawText = await extractBasicPdfText(arrayBuffer);
  } else {
    rawText = await file.text();
  }

  let chunks: DocumentChunkSpec[] = [];
  if (isCode) {
    const lang = LANGUAGE_MAP[ext] || ext;
    chunks = chunkSourceCode(rawText, file.name, lang);
  } else {
    chunks = chunkProseText(rawText);
  }

  return {
    fileName: file.name,
    fileSize: file.size,
    fileType: ext.toUpperCase() || "TXT",
    contentKind,
    rawText,
    chunks,
  };
}
