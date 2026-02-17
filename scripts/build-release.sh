#!/bin/bash
# Agent7 macOS Build and Release Script
# Builds signed, notarized .dmg and releases to GitHub

set -e

echo "🤖 Agent7 macOS Build & Release"
echo "================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check environment variables
if [ -z "$APPLE_ID" ]; then
    echo -e "${RED}❌ APPLE_ID environment variable not set${NC}"
    exit 1
fi

if [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
    echo -e "${RED}❌ APPLE_APP_SPECIFIC_PASSWORD environment variable not set${NC}"
    exit 1
fi

if [ -z "$APPLE_TEAM_ID" ]; then
    echo -e "${RED}❌ APPLE_TEAM_ID environment variable not set${NC}"
    exit 1
fi

echo -e "${BLUE}📋 Configuration:${NC}"
echo "  Apple ID: $APPLE_ID"
echo "  Team ID: $APPLE_TEAM_ID"
echo ""

# Check prerequisites
echo "🔍 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python 3 is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Python $(python3 --version)${NC}"

# Check for macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${YELLOW}⚠️  Warning: Not on macOS. Code signing requires macOS.${NC}"
fi

echo ""
echo "📦 Installing dependencies..."

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf dist node_modules

# Install Node dependencies
echo "Installing Node.js dependencies..."
npm install

# Install Python dependencies
echo "Installing Python dependencies..."
cd python-backend
python3 -m pip install -r requirements.txt --quiet

# Install playwright browsers
echo "Installing Playwright browsers..."
python3 -m playwright install chromium
cd ..

echo ""
echo "🔨 Building application..."
echo "This will build, sign, and notarize the app..."
echo ""

# Build with notarization
npm run build:mac

echo ""
echo "📦 Creating DMG..."

# Check if build succeeded
if [ ! -d "dist/mac" ] && [ ! -d "dist/mac-arm64" ]; then
    echo -e "${RED}❌ Build failed - no output directory found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build successful!${NC}"
echo ""

# List built files
echo "📁 Built files:"
ls -lh dist/*.dmg 2>/dev/null || echo "  No DMG files found"
ls -lh dist/*.zip 2>/dev/null || echo "  No ZIP files found"

echo ""
echo "🚀 Ready for release!"
echo ""
echo "To release to GitHub, run:"
echo "  npm run build:mac:publish"
echo ""
echo "Or manually upload the files from dist/ to GitHub Releases"

# Create release notes template
cat > dist/RELEASE_NOTES.md << 'EOF'
# Agent7 for macOS v2.0.0

## What's New

🤖 **Advanced Agentic AI**
- Autonomous task planning and execution
- Multi-agent orchestration system
- Self-improving capabilities
- Persistent memory system

🌐 **Full Browser Integration**
- Live browser automation with browser-use
- Vision-based UI understanding
- Autonomous web navigation
- Screenshot analysis

🎯 **Multi-Modal Input**
- Voice input with speech-to-text
- Image and screenshot analysis
- File processing (PDFs, code, documents)
- Screen capture integration

🛠️ **Advanced Tools**
- 20+ built-in tools
- Web search and scraping
- Code execution
- File operations
- Data analysis

🎨 **Native macOS Experience**
- Menu bar integration
- Global shortcuts (Cmd+Shift+A)
- Native notifications
- Dark mode support

## Installation

1. Download `Agent7-2.0.0.dmg`
2. Open the DMG file
3. Drag Agent7 to Applications
4. Open from Applications folder
5. Add your API keys in Settings

## System Requirements

- macOS 10.15 (Catalina) or later
- 8GB RAM (16GB recommended)
- 2GB free disk space

## First Launch

On first launch, macOS may warn about the app being downloaded from the internet. 
Click "Open" to proceed. You may need to allow the app in System Preferences > 
Security & Privacy.

## API Keys

The app requires API keys for AI providers:
- OpenAI (GPT-4, GPT-4o)
- Anthropic (Claude 3.5)
- Google (Gemini)

Add keys in: Settings > API Keys

## Support

For issues and feature requests, visit:
https://github.com/Mirxa27/agent7-macos/issues
EOF

echo ""
echo "📝 Release notes created: dist/RELEASE_NOTES.md"
echo ""
echo -e "${GREEN}✨ Build complete!${NC}"