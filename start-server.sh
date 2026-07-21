#!/bin/bash
# Start the NexusCorp lightweight server with auto-restart
cd /home/z/my-project
while true; do
  node lightweight-server.mjs 2>&1
  echo "Server exited, restarting in 2s..." >> /tmp/lw-server.log
  sleep 2
done &
echo $! > /tmp/lw-server.pid
echo "Watchdog started with PID $(cat /tmp/lw-server.pid)"