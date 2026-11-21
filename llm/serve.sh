#!/usr/bin/env bash
# 起本地 LLM 推理服务（职位匹配门禁用）。OpenAI 兼容 API，只绑 127.0.0.1，不出网。
#
# 档位（与 download_model.sh / 面板「模型档预设」对应）：
#   14b（默认）Qwen2.5-14B Q4_K_M：16GB 显存全量 offload（-ngl 99）
#   7b         Qwen2.5-7B  Q4_K_M：8GB 显存
#   -m <路径>  自填 GGUF：轻量本地小模型（JEV 一类）直接给文件路径，
#              或用 Ollama/llamafile 起服务后把面板端点指向它——脚本不必经手
#
# 用法：
#   ./serve.sh [-d]                # 默认 14B；-d 后台（docker stop zhipin-llm 停）
#   ./serve.sh -m 7b [-d]
#   ./serve.sh -m /path/to/model.gguf [-d]
#   ZHIPIN_LLM_PORT=8081 ./serve.sh   # 换端口（面板里的端点要同步改）
#   ./serve.sh -h                  # 本说明
#
# --cache-reuse 让「系统提示 + CV」这段公共前缀在连续判定间复用，每次只增量算 JD。
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL_ARG=""
DETACH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d) DETACH=1 ;;
    -h|--help) grep '^#' "$0" | head -22; exit 0 ;;
    -m) MODEL_ARG="${2:-}"; shift ;;
    *) echo "未知参数：$1（-h 看用法）"; exit 1 ;;
  esac
  shift
done

case "$MODEL_ARG" in
  ""|14b) DEF="qwen2.5-14b-instruct-q4_k_m-00001-of-00003.gguf" ;;
  7b)     DEF="qwen2.5-7b-instruct-q4_k_m.gguf" ;;
  *)      DEF="$MODEL_ARG" ;;  # 已是路径：轻量自填
esac
# 兼容旧环境变量；传分片时 llama.cpp 自动加载同目录其余分片
MODEL="${ZHIPIN_LLM_MODEL:-$DIR/models/$DEF}"
PORT="${ZHIPIN_LLM_PORT:-8080}"

if [[ ! -s "$MODEL" ]]; then
  echo "❌ 模型不存在：$MODEL"
  echo "   下载：./download_model.sh（14b 默认 / 7b / custom 自填）；或 ./serve.sh -m /path/to/model.gguf"
  exit 1
fi
if docker ps --format '{{.Names}}' | grep -q '^zhipin-llm$'; then
  echo "已有 zhipin-llm 容器在跑。先 docker stop zhipin-llm 再起。"
  exit 1
fi

ARGS=(-m "/models/$(basename "$MODEL")" --host 0.0.0.0 --port 8080
      -ngl 99 -c 8192 --cache-reuse 256 -fa on)

if [[ $DETACH == 1 ]]; then
  docker run -d --name zhipin-llm --rm --gpus all \
    -p "127.0.0.1:$PORT:8080" -v "$DIR/models:/models:ro" \
    ghcr.io/ggml-org/llama.cpp:server-cuda "${ARGS[@]}" >/dev/null
else
  docker run -it --name zhipin-llm --rm --gpus all \
    -p "127.0.0.1:$PORT:8080" -v "$DIR/models:/models:ro" \
    ghcr.io/ggml-org/llama.cpp:server-cuda "${ARGS[@]}"
  exit 0
fi

echo "后台启动中（加载权重需 1~2 分钟），等待健康检查…"
ok=0
for _ in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [[ $ok != 1 ]]; then
  echo "❌ 服务未就绪：docker logs zhipin-llm 看原因；docker stop zhipin-llm 清理。"
  exit 1
fi
echo "✅ 就绪：http://127.0.0.1:$PORT（OpenAI 兼容 /v1/chat/completions）"
echo "停止：docker stop zhipin-llm"

# 油猴脚本从求职网站页面里 fetch 本服务，CORS 由 llama-server 负责。
# 这里把预检结果打出来：若下方没有 Access-Control-Allow-Origin 头，
# 判定会失败并熔断——届时把 fetch 换成 GM.xmlHttpRequest（@grant gm_xmlhttprequest）。
echo "--- CORS 预检 ---"
curl -si -X OPTIONS \
  -H "Origin: https://www.zhipin.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  "http://127.0.0.1:$PORT/v1/chat/completions" | head -15 || true
