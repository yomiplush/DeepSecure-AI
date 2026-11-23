import { env, pipeline, RawImage } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web';

const ORT_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/';
const MODEL_CACHE_NAME = 'deepsecure-onnx-models-v1';

env.allowLocalModels = false;
env.useBrowserCache = true;
ort.env.wasm.wasmPaths = {
  mjs: `${ORT_WASM_CDN}ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `${ORT_WASM_CDN}ort-wasm-simd-threaded.asyncify.wasm`,
};

const MODEL_CONFIG = {
  'detectra-openfake': {
    kind: 'raw-onnx',
    repo: 's-gehring/detectra-openfake',
    url: 'https://huggingface.co/s-gehring/detectra-openfake/resolve/main/model.onnx',
    fileLabel: 's-gehring/detectra-openfake (model.onnx)',
    inputSize: 384,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
  'detectra-v1': {
    kind: 'raw-onnx',
    repo: 'TensorFold/detectra-v1',
    url: 'https://huggingface.co/TensorFold/detectra-v1/resolve/main/model.onnx',
    fileLabel: 'TensorFold/detectra-v1 (model.onnx)',
    inputSize: 384,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
  'anime-vit': {
    kind: 'transformers-pipeline',
    repo: 'onnx-community/AI-Anime-Image-Detector-ViT-ONNX',
    dtype: 'q4',
    cropSize: 512,
  },
  'distilled-vit': {
    kind: 'transformers-pipeline',
    repo: 'onnx-community/ai-image-detect-distilled-ONNX',
    dtype: 'q4',
    cropSize: 384,
  },
};

let loadedKey = null;
let loadedRunner = null;
let loadedDevice = 'wasm';

async function detectBestDevice() {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch {
      return 'wasm';
    }
  }
  return 'wasm';
}

async function fetchModelBufferWithProgress(url, fileLabel) {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) {
        self.postMessage({
          type: 'progress',
          progress: { status: 'done', file: fileLabel, progress: 100 },
        });
        return await cached.arrayBuffer();
      }
    } catch {
      // Cache API unavailable (e.g. private context); fall through to network fetch
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`モデル取得失敗: HTTP ${response.status}`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const buf = await response.arrayBuffer();
    return buf;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0) {
      self.postMessage({
        type: 'progress',
        progress: {
          status: 'progress',
          file: fileLabel,
          progress: (received / total) * 100,
        },
      });
    }
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME);
      await cache.put(
        url,
        new Response(merged.buffer, {
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      );
    } catch {
      // Ignore cache quota errors
    }
  }

  self.postMessage({
    type: 'progress',
    progress: { status: 'done', file: fileLabel, progress: 100 },
  });

  return merged.buffer;
}

async function getRunner(modelKey) {
  if (loadedRunner && loadedKey === modelKey) {
    return { runner: loadedRunner, device: loadedDevice, config: MODEL_CONFIG[modelKey] };
  }

  const config = MODEL_CONFIG[modelKey] || MODEL_CONFIG['detectra-openfake'];
  const preferredDevice = await detectBestDevice();

  if (config.kind === 'raw-onnx') {
    const modelBytes = await fetchModelBufferWithProgress(config.url, config.fileLabel);
    const createSession = async (ep) =>
      ort.InferenceSession.create(modelBytes, {
        executionProviders: [ep],
      });

    try {
      loadedRunner = await createSession(preferredDevice);
      loadedDevice = preferredDevice;
    } catch {
      if (preferredDevice !== 'wasm') {
        loadedRunner = await createSession('wasm');
        loadedDevice = 'wasm';
      } else {
        throw new Error('ONNXセッションの初期化に失敗しました');
      }
    }
  } else {
    const loadPipeline = (device) =>
      pipeline('image-classification', config.repo, {
        dtype: config.dtype,
        device,
        progress_callback: (progress) => {
          self.postMessage({ type: 'progress', progress });
        },
      });

    try {
      loadedRunner = await loadPipeline(preferredDevice);
      loadedDevice = preferredDevice;
    } catch {
      if (preferredDevice !== 'wasm') {
        loadedRunner = await loadPipeline('wasm');
        loadedDevice = 'wasm';
      } else {
        throw new Error('Transformers.jsパイプラインの初期化に失敗しました');
      }
    }
  }

  loadedKey = modelKey;
  return { runner: loadedRunner, device: loadedDevice, config };
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

async function cropNativeSubjectPatch(image, patchSize) {
  const w = image.width;
  const h = image.height;
  const cw = Math.min(patchSize, w);
  const ch = Math.min(patchSize, h);
  const x0 = Math.max(0, Math.floor((w - cw) / 2));
  // Bias slightly above vertical center (36%) to target artwork subjects & skip bottom QR/watermark bars
  const y0 = Math.max(0, Math.min(h - ch, Math.floor(h * 0.36 - ch / 2)));
  return image.clone().crop([x0, y0, x0 + cw - 1, y0 + ch - 1]);
}

async function runRawOnnxPatch(session, config, patchImage) {
  const size = config.inputSize;
  const resized =
    patchImage.width === size && patchImage.height === size
      ? patchImage
      : await patchImage.clone().resize(size, size);
  const rgb = resized.rgb();
  const data = rgb.data;
  const hw = size * size;
  const f32 = new Float32Array(3 * hw);
  const [m0, m1, m2] = config.mean;
  const [s0, s1, s2] = config.std;

  for (let i = 0; i < hw; i++) {
    f32[i] = (data[i * 3] / 255 - m0) / s0;
    f32[hw + i] = (data[i * 3 + 1] / 255 - m1) / s1;
    f32[2 * hw + i] = (data[i * 3 + 2] / 255 - m2) / s2;
  }

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const tensor = new ort.Tensor('float32', f32, [1, 3, size, size]);
  const outputs = await session.run({ [inputName]: tensor });
  const logit = Number(outputs[outputName].data[0]);
  return sigmoid(logit);
}

async function prepareShortEdgeCenterCrop(image, shortEdge, cropSize) {
  const minEdge = Math.min(image.width, image.height);
  const scale = shortEdge / minEdge;
  const nw = Math.max(cropSize, Math.round(image.width * scale));
  const nh = Math.max(cropSize, Math.round(image.height * scale));
  const resized = await image.clone().resize(nw, nh);
  return resized.center_crop(cropSize, cropSize);
}

function extractAiScoreFromPipelineResult(items) {
  for (const item of items) {
    const label = String(item.label).toLowerCase();
    if (label === 'ai' || label === 'fake' || label.includes('ai') || label.includes('generated')) {
      return item.score;
    }
  }
  const realItem = items.find((i) => String(i.label).toLowerCase() === 'real');
  return realItem ? 1 - realItem.score : 0.5;
}

self.addEventListener('message', async (event) => {
  const { id, type, modelKey, blob, multiScale = true } = event.data || {};
  if (type !== 'classify') return;

  try {
    self.postMessage({ type: 'status', id, status: 'loading' });
    const { runner, device, config } = await getRunner(modelKey);

    self.postMessage({ type: 'status', id, status: 'inferring', device });
    const startedAt = performance.now();
    const image = await RawImage.fromBlob(blob);
    const minEdge = Math.min(image.width, image.height);

    const scaleResults = [];

    if (config.kind === 'raw-onnx') {
      const globalPatch = await prepareShortEdgeCenterCrop(image, 440, config.inputSize);
      const pGlobal = await runRawOnnxPatch(runner, config, globalPatch);
      scaleResults.push({ name: '全体縮小 (440px)', aiScore: pGlobal });

      if (multiScale && minEdge >= 520) {
        const midPatch = await prepareShortEdgeCenterCrop(image, 768, config.inputSize);
        const pMid = await runRawOnnxPatch(runner, config, midPatch);
        scaleResults.push({ name: '高精細中央 (768px)', aiScore: pMid });

        const nativePatch = await cropNativeSubjectPatch(image, config.inputSize);
        const pNative = await runRawOnnxPatch(runner, config, nativePatch);
        scaleResults.push({ name: '原寸 1:1 (中央上)', aiScore: pNative });
      }
    } else {
      const fullScores = await runner(image, { top_k: 5 });
      scaleResults.push({
        name: '全体縮小ビュー',
        aiScore: extractAiScoreFromPipelineResult(fullScores),
      });

      if (multiScale && minEdge >= 640) {
        const nativePatch = await cropNativeSubjectPatch(image, config.cropSize);
        const patchScores = await runner(nativePatch, { top_k: 5 });
        scaleResults.push({
          name: `原寸 1:1 (${config.cropSize}px 中央上)`,
          aiScore: extractAiScoreFromPipelineResult(patchScores),
        });
      }
    }

    const peakAiScore = Math.max(...scaleResults.map((s) => s.aiScore));
    const results = [
      { label: 'ai', score: peakAiScore },
      { label: 'real', score: 1 - peakAiScore },
    ].sort((a, b) => b.score - a.score);

    const elapsedMs = Math.round(performance.now() - startedAt);

    self.postMessage({
      type: 'result',
      id,
      modelKey,
      device,
      elapsedMs,
      results,
      scaleResults,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      message: error?.message || String(error),
    });
  }
});
