#!/usr/bin/env bash
# 下载判定模型 GGUF 到 llm/models/（已 gitignore）。档位与面板「模型档预设」对应：
#
# 用法：
#   ./download_model.sh          # 14B（默认）：Qwen2.5-14B Q4_K_M，3 分片约 8.4GB，16GB 显存全量 offload
#   ./download_model.sh 7b       # 7B：Qwen2.5-7B Q4_K_M 约 4.7GB，8GB 显存
#   HF_REPO=<repo> HF_FILE=<file.gguf> ./download_model.sh custom
#                                # 轻量自填：CPU/低显存用的 JEV 一类小模型，自己在面板填型号、
#                                # 这里给 repo/文件名（或直接用 Ollama/llamafile 起服务，端点指向它即可）
#
# 国内直连 huggingface.co 不通，默认走镜像 hf-mirror.com（实测免代理可达）；
# 有代理的话也可 export HF_ENDPOINT=https://huggingface.co 走官方源。
# 断点续传：直接重跑即可（curl -C - 续 .part 文件）。
set -euo pipefail

MODEL_DIR="$(cd "$(dirname "$0")" && pwd)/models"
BASE="${HF_ENDPOINT:-https://hf-mirror.com}"
TIER="${1:-14b}"

case "$TIER" in
  14b)
    REPO="Qwen/Qwen2.5-14B-Instruct-GGUF"
    FILES=(
      "qwen2.5-14b-instruct-q4_k_m-00001-of-00003.gguf"
      "qwen2.5-14b-instruct-q4_k_m-00002-of-00003.gguf"
      "qwen2.5-14b-instruct-q4_k_m-00003-of-00003.gguf"
    )
    ;;
  7b)
    REPO="Qwen/Qwen2.5-7B-Instruct-GGUF"
    FILES=("qwen2.5-7b-instruct-q4_k_m.gguf")
    ;;
  custom)
    REPO="${HF_REPO:-}"
    FILES=("${HF_FILE:-}")
    if [[ -z "$REPO" || -z "$FILES" ]]; then
      echo "用法：HF_REPO=<repo> HF_FILE=<file.gguf> ./download_model.sh custom"
      exit 1
    fi
    ;;
  *)
    echo "未知档位：$TIER（可选：14b / 7b / custom）"
    exit 1
    ;;
esac

mkdir -p "$MODEL_DIR"
for f in "${FILES[@]}"; do
  if [[ -s "$MODEL_DIR/$f" ]]; then
    echo "已存在：$f（$(du -h "$MODEL_DIR/$f" | cut -f1)）"
    continue
  fi
  echo "下载 $BASE/$REPO/resolve/main/$f"
  if ! curl -fL -C - --retry 3 --retry-delay 5 -o "$MODEL_DIR/$f.part" "$BASE/$REPO/resolve/main/$f"; then
    echo "❌ 下载失败。断点续传直接重跑；换源：export HF_ENDPOINT=https://huggingface.co（需代理）。"
    exit 1
  fi
  mv "$MODEL_DIR/$f.part" "$MODEL_DIR/$f"
  echo "  ✅ $f（$(du -h "$MODEL_DIR/$f" | cut -f1)）"
done

echo "✅ 全部就绪（多分片 GGUF 从第一个分片自动加载其余分片）："
for f in "${FILES[@]}"; do du -h "$MODEL_DIR/$f"; done
case "$TIER" in
  7b)     echo "下一步：./serve.sh -m 7b；面板「模型档」选「本地 7B」。" ;;
  custom) echo "下一步：./serve.sh -m \"$MODEL_DIR/${FILES[0]}\"；面板「模型档」选「本地轻量」并填模型名。" ;;
  *)      echo "下一步：./serve.sh；面板「模型档」选「本地 14B」。" ;;
esac
