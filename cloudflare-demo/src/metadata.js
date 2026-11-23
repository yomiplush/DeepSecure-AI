/**
 * Client-side PNG chunk & binary string inspector for common AI generation metadata.
 * Runs 100% locally in the browser without uploading files.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const AI_TEXT_KEYS = new Map([
  ['parameters', 'Stable Diffusion (WebUI / Forge)'],
  ['prompt', 'ComfyUI Prompt JSON'],
  ['workflow', 'ComfyUI Workflow JSON'],
  ['invokeai_metadata', 'InvokeAI'],
  ['sd-metadata', 'InvokeAI / SD Metadata'],
  ['comment', 'Comment / NovelAI Metadata'],
  ['software', 'Software Tag'],
  ['source', 'Source Tag'],
  ['description', 'Description Tag'],
  ['xml:com.adobe.xmp', 'Adobe XMP Metadata'],
]);

const AI_SIGNATURE_PATTERNS = [
  { pattern: /NovelAI/i, label: 'NovelAI' },
  { pattern: /ComfyUI/i, label: 'ComfyUI' },
  { pattern: /Automatic1111|Steps:\s*\d+,\s*Sampler:/i, label: 'Stable Diffusion WebUI' },
  { pattern: /Midjourney/i, label: 'Midjourney' },
  { pattern: /DALL-E|DALL·E/i, label: 'DALL-E' },
  { pattern: /Adobe Firefly/i, label: 'Adobe Firefly' },
  { pattern: /c2pa|jumbf/i, label: 'C2PA Content Credentials' },
  { pattern: /trainedAlgorithmicMedia/i, label: 'IPTC/C2PA Trained Algorithmic Media' },
];

function isPng(bytes) {
  if (bytes.length < 8) return false;
  return PNG_SIGNATURE.every((b, idx) => bytes[idx] === b);
}

function decodeLatin1(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function extractPngTextChunks(buffer) {
  const bytes = new Uint8Array(buffer);
  if (!isPng(bytes)) return [];

  const view = new DataView(buffer);
  const chunks = [];
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > bytes.length) break;

    if (type === 'tEXt' || type === 'iTXt') {
      const chunkBytes = bytes.slice(dataStart, dataEnd);
      const nullIdx = chunkBytes.indexOf(0);
      if (nullIdx > 0) {
        const key = decodeLatin1(chunkBytes.slice(0, nullIdx));
        let valueBytes = chunkBytes.slice(nullIdx + 1);
        if (type === 'iTXt' && valueBytes.length > 4) {
          // Skip compression flag (1), compression method (1), language tag\0, translated keyword\0
          let pos = 2;
          const langEnd = valueBytes.indexOf(0, pos);
          if (langEnd !== -1) {
            const transEnd = valueBytes.indexOf(0, langEnd + 1);
            if (transEnd !== -1) {
              valueBytes = valueBytes.slice(transEnd + 1);
            }
          }
        }
        const value = new TextDecoder('utf-8', { fatal: false }).decode(valueBytes).slice(0, 600);
        chunks.push({ type, key, value });
      }
    }

    if (type === 'IEND') break;
    offset = dataEnd + 4; // skip CRC
  }

  return chunks;
}

export async function inspectImageMetadata(blob, fileName = 'image') {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const pngChunks = extractPngTextChunks(buffer);

  // Scan first 256KB for readable ASCII metadata signatures (EXIF/XMP/PNG)
  const scanLimit = Math.min(bytes.length, 262144);
  const asciiProbe = decodeLatin1(bytes.slice(0, scanLimit));

  const detectedSignals = [];
  const extractedEntries = [];

  for (const chunk of pngChunks) {
    const normalizedKey = chunk.key.toLowerCase();
    const knownLabel = AI_TEXT_KEYS.get(normalizedKey);
    if (knownLabel || chunk.value.length > 0) {
      extractedEntries.push({
        key: chunk.key,
        source: knownLabel || `PNG ${chunk.type}`,
        preview: chunk.value.replace(/\s+/g, ' ').trim().slice(0, 220),
      });
    }
    if (normalizedKey === 'parameters' || normalizedKey === 'prompt' || normalizedKey === 'workflow') {
      detectedSignals.push(knownLabel);
    }
  }

  for (const sig of AI_SIGNATURE_PATTERNS) {
    if (sig.pattern.test(asciiProbe)) {
      if (!detectedSignals.includes(sig.label)) {
        detectedSignals.push(sig.label);
      }
    }
  }

  return {
    fileName,
    byteLength: bytes.length,
    isPng: isPng(bytes),
    detectedSignals,
    extractedEntries: extractedEntries.slice(0, 6),
  };
}
