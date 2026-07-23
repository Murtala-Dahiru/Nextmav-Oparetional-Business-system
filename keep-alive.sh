#!/bin/bash
# Keep-alive wrapper for the lightweight server
cd /home/z/my-project
while true; do
  node /home/z/my-project/lightweight-server.mjs 2>&1
  echo "Server exited, restarting in 1s..." >&2
  sleep 1
done