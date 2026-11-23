import { env, pipeline, RawImage } from '@huggingface/transformers';

// Ensure models are fetched directly from Hugging Face Hub and cached in browser Cache API
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_CONFIG = {
  'anime-vit': {
    repo: 'onnx-community/AI-Anime-Image-Detector-ViT-ONNX',
    dtype: 'q4',
    title: 'AI-Anime-Image-Detector-ViT-ONNX',
  },
  'distilled-vit': {
    repo: 'onnx-community/ai-image-detect-distilled-ONNX',
    dtype: 'q4',
    title: 'ai-image-detect-distilled-ONNX',
  },
};

let currentModelKey = null;
let currentPipeline = null;
let currentDevice = 'wasm';

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

async function getClassifier(modelKey) {
  if (currentPipeline && currentModelKey === modelKey) {
    return { classifier: currentPipeline, device: currentDevice };
  }

  const config = MODEL_CONFIG[modelKey] || MODEL_CONFIG['anime-vit'];
  const preferredDevice = await detectBestDevice();

  const progress_callback = (progress) => {
    self.postMessage({
      type: 'progress',
      progress,
    });
  };

  const loadWithDevice = async (device) => {
    return pipeline('image-classification', config.repo, {
      dtype: config.dtype,
      device,
      progress_callback,
    });
  };

  try {
    currentPipeline = await loadWithDevice(preferredDevice);
    currentDevice = preferredDevice;
  } catch (err) {
    if (preferredDevice !== 'wasm') {
      currentPipeline = await loadWithDevice('wasm');
      currentDevice = 'wasm';
    } else {
      throw err;
    }
  }

  currentModelKey = modelKey;
  return { classifier: currentPipeline, device: currentDevice };
}

self.addEventListener('message', async (event) => {
  const { id, type, modelKey, blob } = event.data || {};
  if (type !== 'classify') return;

  try {
    self.postMessage({ type: 'status', id, status: 'loading' });
    const { classifier, device } = await getClassifier(modelKey);

    self.postMessage({ type: 'status', id, status: 'inferring', device });
    const startedAt = performance.now();
    const image = await RawImage.fromBlob(blob);
    const results = await classifier(image, { top_k: 5 });
    const elapsedMs = Math.round(performance.now() - startedAt);

    self.postMessage({
      type: 'result',
      id,
      modelKey,
      device,
      elapsedMs,
      results,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      message: error?.message || String(error),
    });
  }
});
