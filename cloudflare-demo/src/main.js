import './style.css';
import { inspectImageMetadata } from './metadata.js';

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const elements = {
  modelSelect: document.getElementById('model-select'),
  tabUpload: document.getElementById('tab-upload'),
  tabDraw: document.getElementById('tab-draw'),
  paneUpload: document.getElementById('pane-upload'),
  paneDraw: document.getElementById('pane-draw'),
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('file-input'),
  previewWrap: document.getElementById('preview-wrap'),
  previewImage: document.getElementById('preview-image'),
  previewDimensions: document.getElementById('preview-dimensions'),
  sketchCanvas: document.getElementById('sketch-canvas'),
  brushColor: document.getElementById('brush-color'),
  brushSize: document.getElementById('brush-size'),
  brushSizeLabel: document.getElementById('brush-size-label'),
  btnUndo: document.getElementById('btn-undo'),
  btnClear: document.getElementById('btn-clear'),
  analyzeBtn: document.getElementById('analyze-btn'),
  modelStatus: document.getElementById('model-status'),
  progressWrap: document.getElementById('progress-wrap'),
  progressFile: document.getElementById('progress-file'),
  progressPct: document.getElementById('progress-pct'),
  progressBar: document.getElementById('progress-bar'),
  runtimeBadge: document.getElementById('runtime-badge'),
  resultEmpty: document.getElementById('result-empty'),
  resultCard: document.getElementById('result-card'),
  verdictBanner: document.getElementById('verdict-banner'),
  verdictLabel: document.getElementById('verdict-label'),
  verdictSub: document.getElementById('verdict-sub'),
  scoresList: document.getElementById('scores-list'),
  metaSignals: document.getElementById('meta-signals'),
  metaEntries: document.getElementById('meta-entries'),
};

let activeTab = 'upload';
let currentBlob = null;
let currentFileName = 'image.png';
let currentPreviewUrl = null;
let pendingRequestId = 0;
let isBusy = false;

// --- Sketchpad State ---
const ctx = elements.sketchCanvas.getContext('2d');
let isDrawing = false;
let hasDrawn = false;
const historyStack = [];

function initSketchpad() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, elements.sketchCanvas.width, elements.sketchCanvas.height);
  saveCanvasSnapshot();
}

function saveCanvasSnapshot() {
  if (historyStack.length >= 20) historyStack.shift();
  historyStack.push(ctx.getImageData(0, 0, elements.sketchCanvas.width, elements.sketchCanvas.height));
}

function getCanvasPoint(e) {
  const rect = elements.sketchCanvas.getBoundingClientRect();
  const scaleX = elements.sketchCanvas.width / rect.width;
  const scaleY = elements.sketchCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

elements.sketchCanvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  elements.sketchCanvas.setPointerCapture(e.pointerId);
  isDrawing = true;
  hasDrawn = true;
  const { x, y } = getCanvasPoint(e);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.strokeStyle = elements.brushColor.value;
  ctx.lineWidth = Number(elements.brushSize.value);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  updateAnalyzeButton();
});

elements.sketchCanvas.addEventListener('pointermove', (e) => {
  if (!isDrawing) return;
  const { x, y } = getCanvasPoint(e);
  ctx.lineTo(x, y);
  ctx.stroke();
});

function stopDrawing() {
  if (!isDrawing) return;
  isDrawing = false;
  ctx.closePath();
  saveCanvasSnapshot();
}

elements.sketchCanvas.addEventListener('pointerup', stopDrawing);
elements.sketchCanvas.addEventListener('pointercancel', stopDrawing);

elements.brushSize.addEventListener('input', () => {
  elements.brushSizeLabel.textContent = `${elements.brushSize.value}px`;
});

elements.btnUndo.addEventListener('click', () => {
  if (historyStack.length > 1) {
    historyStack.pop();
    const prev = historyStack[historyStack.length - 1];
    ctx.putImageData(prev, 0, 0);
  }
});

elements.btnClear.addEventListener('click', () => {
  hasDrawn = false;
  historyStack.length = 0;
  initSketchpad();
  updateAnalyzeButton();
});

initSketchpad();

// --- Tabs ---
function switchTab(tab) {
  activeTab = tab;
  const isUpload = tab === 'upload';
  elements.tabUpload.classList.toggle('active', isUpload);
  elements.tabDraw.classList.toggle('active', !isUpload);
  elements.tabUpload.setAttribute('aria-selected', String(isUpload));
  elements.tabDraw.setAttribute('aria-selected', String(!isUpload));
  elements.paneUpload.classList.toggle('active', isUpload);
  elements.paneDraw.classList.toggle('active', !isUpload);
  updateAnalyzeButton();
}

elements.tabUpload.addEventListener('click', () => switchTab('upload'));
elements.tabDraw.addEventListener('click', () => switchTab('draw'));

// --- Image Selection / Paste / Drop ---
function setSelectedImage(blob, fileName) {
  if (!blob) return;
  currentBlob = blob;
  currentFileName = fileName || 'image.png';

  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }
  currentPreviewUrl = URL.createObjectURL(blob);
  elements.previewImage.src = currentPreviewUrl;
  elements.previewWrap.classList.remove('hidden');

  const img = new Image();
  img.onload = () => {
    const kb = (blob.size / 1024).toFixed(1);
    elements.previewDimensions.textContent = `${currentFileName} ・ ${img.naturalWidth} × ${img.naturalHeight}px ・ ${kb} KB`;
  };
  img.src = currentPreviewUrl;

  switchTab('upload');
  updateAnalyzeButton();
}

elements.dropzone.addEventListener('click', () => elements.fileInput.click());
elements.dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    elements.fileInput.click();
  }
});

elements.fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) setSelectedImage(file, file.name);
});

elements.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  elements.dropzone.classList.add('dragover');
});

elements.dropzone.addEventListener('dragleave', () => {
  elements.dropzone.classList.remove('dragover');
});

elements.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  elements.dropzone.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) {
    setSelectedImage(file, file.name);
  }
});

window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        setSelectedImage(file, `pasted-${Date.now()}.png`);
        break;
      }
    }
  }
});

// --- Built-in Procedural Test Samples ---
function createSampleBlob(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const c = canvas.getContext('2d');

  if (kind === 'hand-sketch') {
    c.fillStyle = '#faf8f2';
    c.fillRect(0, 0, 512, 512);
    c.strokeStyle = '#1e293b';
    c.lineWidth = 4;
    c.lineCap = 'round';
    // Simple hand-drawn character face sketch
    c.beginPath();
    c.arc(256, 250, 120, 0, Math.PI * 2);
    c.stroke();
    // Hair strokes
    for (let i = -3; i <= 3; i++) {
      c.beginPath();
      c.moveTo(256 + i * 28, 125);
      c.quadraticCurveTo(256 + i * 35, 175, 256 + i * 20, 200);
      c.stroke();
    }
    // Eyes & smile
    c.beginPath();
    c.arc(212, 245, 12, 0, Math.PI * 2);
    c.arc(300, 245, 12, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(256, 278, 36, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
  } else {
    // Glossy synthetic gradient + geometric render
    const grad = c.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#6d28d9');
    grad.addColorStop(1, '#ec4899');
    c.fillStyle = grad;
    c.fillRect(0, 0, 512, 512);

    const orb = c.createRadialGradient(256, 240, 20, 256, 256, 170);
    orb.addColorStop(0, '#fef08a');
    orb.addColorStop(0.45, '#f472b6');
    orb.addColorStop(1, 'rgba(56, 189, 248, 0.05)');
    c.fillStyle = orb;
    c.beginPath();
    c.arc(256, 256, 170, 0, Math.PI * 2);
    c.fill();
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

document.querySelectorAll('[data-sample]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const kind = btn.getAttribute('data-sample');
    const blob = await createSampleBlob(kind);
    const name = kind === 'hand-sketch' ? 'sample-hand-sketch.png' : 'sample-synthetic.png';
    setSelectedImage(blob, name);
    await runAnalysis();
  });
});

function updateAnalyzeButton() {
  if (isBusy) {
    elements.analyzeBtn.disabled = true;
    return;
  }
  const ready = activeTab === 'upload' ? Boolean(currentBlob) : hasDrawn;
  elements.analyzeBtn.disabled = !ready;
}

// --- Inference & Metadata Rendering ---
function classifyLabelSemantics(rawLabel) {
  const lower = String(rawLabel).toLowerCase();
  if (lower === 'ai' || lower === 'fake' || lower.includes('ai') || lower.includes('generated')) {
    return {
      isAi: true,
      display: `AI生成画像 (${rawLabel})`,
    };
  }
  return {
    isAi: false,
    display: `手描き・人間制作 (${rawLabel})`,
  };
}

function renderMetadata(meta) {
  elements.metaSignals.innerHTML = '';
  elements.metaEntries.innerHTML = '';

  const formatTag = document.createElement('span');
  formatTag.className = 'meta-tag';
  formatTag.textContent = meta.isPng ? 'PNG構造検査済み' : '非PNG (EXIF/XMP文字列検査)';
  elements.metaSignals.appendChild(formatTag);

  if (meta.detectedSignals.length === 0) {
    const cleanTag = document.createElement('span');
    cleanTag.className = 'meta-tag';
    cleanTag.textContent = 'AI生成ツール固有のメタデータ未検出';
    elements.metaSignals.appendChild(cleanTag);
  } else {
    for (const signal of meta.detectedSignals) {
      const warnTag = document.createElement('span');
      warnTag.className = 'meta-tag warn';
      warnTag.textContent = `検出: ${signal}`;
      elements.metaSignals.appendChild(warnTag);
    }
  }

  if (meta.extractedEntries.length > 0) {
    for (const entry of meta.extractedEntries) {
      const div = document.createElement('div');
      div.className = 'meta-entry';
      div.innerHTML = `<strong>${escapeHtml(entry.key)}</strong> (${escapeHtml(entry.source)}): ${escapeHtml(entry.preview)}`;
      elements.metaEntries.appendChild(div);
    }
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderResults({ results, elapsedMs, device, meta }) {
  elements.resultEmpty.classList.add('hidden');
  elements.resultCard.classList.remove('hidden');

  const sorted = [...results].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const topInfo = classifyLabelSemantics(top.label);
  const pct = (top.score * 100).toFixed(1);

  elements.verdictBanner.className = `verdict-banner ${topInfo.isAi ? 'is-ai' : 'is-human'}`;
  elements.verdictLabel.textContent = topInfo.isAi
    ? `判定: AI生成の可能性が高い (${pct}%)`
    : `判定: 手描き・人間制作の可能性が高い (${pct}%)`;
  elements.verdictSub.textContent = `推論時間: ${elapsedMs}ms ・ 実行バックエンド: ${device.toUpperCase()} ・ 対象: ${meta.fileName}`;

  elements.scoresList.innerHTML = '';
  for (const item of sorted) {
    const info = classifyLabelSemantics(item.label);
    const scorePct = (item.score * 100).toFixed(1);
    const row = document.createElement('div');
    row.className = 'score-row';
    row.innerHTML = `
      <div class="score-row-top">
        <span>${escapeHtml(info.display)}</span>
        <span>${scorePct}%</span>
      </div>
      <div class="score-track">
        <div class="score-fill ${info.isAi ? 'ai' : 'human'}" style="width: ${scorePct}%"></div>
      </div>
    `;
    elements.scoresList.appendChild(row);
  }

  renderMetadata(meta);
}

let activeMeta = null;

async function runAnalysis() {
  if (isBusy) return;

  let targetBlob = currentBlob;
  let targetName = currentFileName;

  if (activeTab === 'draw') {
    targetBlob = await new Promise((resolve) =>
      elements.sketchCanvas.toBlob((blob) => resolve(blob), 'image/png')
    );
    targetName = 'hand-drawn-canvas.png';
  }

  if (!targetBlob) return;

  isBusy = true;
  updateAnalyzeButton();
  elements.runtimeBadge.textContent = '解析中...';
  elements.modelStatus.textContent = 'モデル準備中...';

  activeMeta = await inspectImageMetadata(targetBlob, targetName);
  const requestId = ++pendingRequestId;

  worker.postMessage({
    id: requestId,
    type: 'classify',
    modelKey: elements.modelSelect.value,
    blob: targetBlob,
  });
}

elements.analyzeBtn.addEventListener('click', runAnalysis);

worker.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'progress') {
    const p = msg.progress;
    if (p?.status === 'progress' && typeof p.progress === 'number') {
      elements.progressWrap.classList.remove('hidden');
      elements.progressFile.textContent = p.file || 'モデルファイル取得中...';
      const rounded = Math.min(100, Math.round(p.progress));
      elements.progressPct.textContent = `${rounded}%`;
      elements.progressBar.style.width = `${rounded}%`;
    } else if (p?.status === 'done') {
      elements.progressBar.style.width = '100%';
      elements.progressPct.textContent = '100%';
    }
    return;
  }

  if (msg.id !== pendingRequestId) return;

  if (msg.type === 'status') {
    if (msg.status === 'loading') {
      elements.modelStatus.textContent = 'ONNXモデル読込中...';
    } else if (msg.status === 'inferring') {
      elements.progressWrap.classList.add('hidden');
      elements.modelStatus.textContent = `推論実行中 (${msg.device.toUpperCase()})...`;
    }
    return;
  }

  if (msg.type === 'result') {
    isBusy = false;
    updateAnalyzeButton();
    elements.progressWrap.classList.add('hidden');
    elements.modelStatus.textContent = `準備完了 (${msg.device.toUpperCase()} / キャッシュ済)`;
    elements.runtimeBadge.textContent = `${msg.device.toUpperCase()} ・ ${msg.elapsedMs}ms`;
    renderResults({
      results: msg.results,
      elapsedMs: msg.elapsedMs,
      device: msg.device,
      meta: activeMeta,
    });
    return;
  }

  if (msg.type === 'error') {
    isBusy = false;
    updateAnalyzeButton();
    elements.progressWrap.classList.add('hidden');
    elements.modelStatus.textContent = `エラー: ${msg.message}`;
    elements.runtimeBadge.textContent = '推論エラー';
  }
});
