#!/bin/bash

echo "🔄 Restarting backend server..."

# Kill any existing node processes running on port 5000
echo "Stopping existing backend..."
lsof -ti:5000 | xargs kill -9 2>/dev/null || true

# Wait a moment
sleep 2

# Start the backend
echo "Starting backend server..."
cd lead-scraper-backend
npm start &

echo "✅ Backend server restarted!"
echo "The server should now accept partial information for manual lead enrichment."
