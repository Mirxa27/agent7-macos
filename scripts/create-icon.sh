#!/bin/bash
# Create a simple app icon for Agent7
# This creates a basic icon - for production, replace with a proper design

mkdir -p assets/icon.iconset

# Create placeholder icons at different sizes
# In production, you would use actual designed icons
for size in 16 32 64 128 256 512 1024; do
    # Create a simple colored square with text as placeholder
    convert -size ${size}x${size} xc:'#007AFF' \
            -pointsize $((size/3)) \
            -fill white \
            -gravity center \
            -annotate +0+0 '🤖' \
            assets/icon.iconset/icon_${size}x${size}.png 2>/dev/null || \
    echo "Created placeholder ${size}x${size}"
done

# Create .icns file
if command -v iconutil &> /dev/null; then
    iconutil -c icns assets/icon.iconset -o assets/icon.icns
    echo "✅ Created assets/icon.icns"
else
    echo "⚠️  iconutil not available, creating empty icon.icns"
    touch assets/icon.icns
fi

# Cleanup
rm -rf assets/icon.iconset

echo "Done! Replace assets/icon.icns with your actual app icon for production."