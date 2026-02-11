#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  Aegis v3 — vLLM for Parallel Development Swarm
#
#  Concurrency math (MoE, 3B active/token):
#    Commander ×1 + Worker ×4 + Scout ×4 + Librarian ×4 = 13 sessions
#    Each session ~3B active params → fits H200 141GB with room
#
#  --max-num-seqs 16: up to 16 concurrent requests
# ═══════════════════════════════════════════════════════════
set -euo pipefail

MODEL="${AEGIS_MODEL:-unsloth/Qwen3-Coder-Next-FP8-Dynamic}"
SERVED_NAME="${AEGIS_SERVED_NAME:-qwen3-coder-next}"
PORT="${AEGIS_PORT:-8001}"
GPU_ID="${AEGIS_GPU:-0}"
MAX_MODEL_LEN="${AEGIS_CTX:-131072}"
GPU_MEM_UTIL="${AEGIS_MEM:-0.92}"
MAX_NUM_SEQS="${AEGIS_BATCH:-16}"  # ← 스웜용: Commander + Workers + Scouts + Librarians

echo "🛡️  Aegis Swarm — vLLM Server"
echo "   Model:       ${MODEL}"
echo "   Port:        ${PORT}"
echo "   GPU:         ${GPU_ID}"
echo "   Context:     ${MAX_MODEL_LEN} tokens"
echo "   Concurrency: ${MAX_NUM_SEQS} sequences (swarm mode)"
echo "   Memory:      ${GPU_MEM_UTIL}"
echo ""

if command -v nvidia-smi &>/dev/null; then
  nvidia-smi --query-gpu=index,name,memory.total,memory.free --format=csv,noheader
  echo ""
fi

CUDA_VISIBLE_DEVICES="${GPU_ID}" \
PYTORCH_CUDA_ALLOC_CONF="expandable_segments:False" \
exec vllm serve "${MODEL}" \
  --served-model-name "${SERVED_NAME}" \
  --tensor-parallel-size 1 \
  --tool-call-parser qwen3_coder \
  --enable-auto-tool-choice \
  --dtype bfloat16 \
  --seed 3407 \
  --max-model-len "${MAX_MODEL_LEN}" \
  --max-num-seqs "${MAX_NUM_SEQS}" \
  --gpu-memory-utilization "${GPU_MEM_UTIL}" \
  --port "${PORT}" \
  --disable-log-requests \
  "$@"
