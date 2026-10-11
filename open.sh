#!/bin/bash
# Access PDF Toolkit with custom domain
# This script opens the app in your browser with a friendly URL

# On first run, you may need to add this to your device's hosts:
# Edit: Settings > Apps > Termux > Permissions > Files > Allow access to all files
# Then: su -c 'echo "127.0.0.1 pdf-toolkit" >> /etc/hosts'

# For now, access via localhost:
echo "Opening PDF Toolkit..."
echo "Access at: https://localhost:5174"

# Try to open in default browser (if available)
if command -v xdg-open &> /dev/null; then
  xdg-open "https://localhost:5174"
elif command -v open &> /dev/null; then
  open "https://localhost:5174"
else
  echo "Manually open: https://localhost:5174"
fi
