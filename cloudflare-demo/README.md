# DeepSecure-AI Cloudflare Pages Demo (AI絵 vs 手描き絵 判定デモ)

[DeepSecure-AI](https://github.com/Divith123/DeepSecure-AI) のフォークに追加した、**Cloudflare Pages だけで動作する完全ブラウザ完結型の AI絵 / 手描き絵 判定デモ** です。

## 特徴

- **サーバー不要・完全ブラウザ推論**: `onnxruntime-web` + `@huggingface/transformers` (WebGPU & WASM) により、画像は一切外部サーバーへ送信されません。
- **用途に合わせた 4 モデル切替**:
  - **ChatGPT・最新AI対応汎用 (Default)**: [`s-gehring/detectra-openfake`](https://huggingface.co/s-gehring/detectra-openfake) (CC BY-NC 4.0 非商用デモ向け, ViT-S 384px, 約30MB)
  - **最新汎用・手描きアニメ対応**: [`TensorFold/detectra-v1`](https://huggingface.co/TensorFold/detectra-v1) (MIT, ViT-S 384px, 約44MB)
  - **2Dアニメ・SD/NAI特化**: [`onnx-community/AI-Anime-Image-Detector-ViT-ONNX`](https://huggingface.co/onnx-community/AI-Anime-Image-Detector-ViT-ONNX) (Apache-2.0, ViT 512px, `q4` 約64MB)
  - **超軽量テスト用**: [`onnx-community/ai-image-detect-distilled-ONNX`](https://huggingface.co/onnx-community/ai-image-detect-distilled-ONNX) (MIT, Distilled ViT 224px, `q4` 約11MB)
- **マルチスケール・パッチ推論**: 全体縮小（440px）だけでなく高精細中央（768px）・原寸 1:1 クロップ（384px）を併用することで、縮小による微細テクスチャの消失や QRコード・枠などの外乱を防ぎます。
- **その場で手描きテスト可能**: 画像アップロード / `Ctrl+V` 貼り付けに加え、Canvas 上で直接描いたイラストもそのまま判定できます。
- **PNG/C2PA/EXIF メタデータ検査**: Stable Diffusion (`parameters`) / ComfyUI (`prompt`, `workflow`) / NovelAI / C2PA (`caBX`) などの埋め込みメタデータもクライアント側で検出します。

## ローカル実行

```bash
cd cloudflare-demo
npm install
npm run dev
```

## Cloudflare Pages デプロイ設定

Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** からリポジトリを選択し、以下を設定してください:

- **Root directory**: `cloudflare-demo`
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Node.js version** (必要な場合): 環境変数 `NODE_VERSION` = `20` 以上
