# DeepSecure-AI Cloudflare Pages Demo (AI絵 vs 手描き絵 判定デモ)

[DeepSecure-AI](https://github.com/Divith123/DeepSecure-AI) のフォークに追加した、**Cloudflare Pages だけで動作する完全ブラウザ完結型の AI絵 / 手描き絵 判定デモ** です。

## 特徴

- **サーバー不要・完全ブラウザ推論**: `@huggingface/transformers` (ONNX Runtime Web / WebGPU & WASM) により、画像は一切外部サーバーへ送信されません。
- **用途に合わせた2モデル切替**:
  - **イラスト・アニメ絵特化 (Default)**: [`onnx-community/AI-Anime-Image-Detector-ViT-ONNX`](https://huggingface.co/onnx-community/AI-Anime-Image-Detector-ViT-ONNX) (Apache-2.0, ViT 512px, 量子化 `q4` 約64MB)
  - **軽量・汎用テスト用**: [`onnx-community/ai-image-detect-distilled-ONNX`](https://huggingface.co/onnx-community/ai-image-detect-distilled-ONNX) (MIT, Distilled ViT 224px, 量子化 `q4` 約11MB)
- **その場で手描きテスト可能**: 画像アップロード / `Ctrl+V` 貼り付けに加え、Canvas 上で直接描いたイラストもそのまま判定できます。
- **PNG/EXIF メタデータ検査**: Stable Diffusion (`parameters`) / ComfyUI (`prompt`, `workflow`) / NovelAI / C2PA などの埋め込みメタデータもクライアント側で検出します。

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

> **Note**: ONNX モデル本体は初回推論時にブラウザから Hugging Face Hub 経由で取得・キャッシュされるため、Cloudflare Pages の 1ファイル 25 MiB 上限には引っかかりません。
