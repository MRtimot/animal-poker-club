#!/bin/bash
# 开发模式：同时启动游戏服务器（3001）与网页（5173）
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:$PATH"
exec npm run dev
