#!/bin/bash

# Find active IP across wlan0, ap0, swlan0, or default route
IP=$(ifconfig 2>/dev/null | grep -E 'inet (192\.|10\.|172\.)' | awk '{print $2}' | head -n 1)

if [ -z "$IP" ]; then
    IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}')
fi

if [ -z "$IP" ]; then
    IP="127.0.0.1"
fi

clear
echo "================================================="
echo "       🚀 MIKICONNECT LOCAL SERVER ACTIVE       "
echo "================================================="
echo ""
echo "📱 ON THIS PHONE (Host):"
echo "   http://localhost:5000"
echo ""
echo "📲 ON THE SECOND PHONE (Same Wi-Fi/Hotspot):"
echo "   http://$IP:5000"
echo ""
echo "================================================="
echo "Press CTRL+C to stop the server"
echo ""

node server.js

