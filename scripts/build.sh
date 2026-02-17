#!/bin/bash
# Agent7 macOS Build Script
# Builds the native macOS app with all advanced features

set -e

echo "🤖 Agent7 macOS Builder"
echo "======================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js version 18+ required${NC}"
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
    echo -e "${YELLOW}⚠️  Not on macOS. Building may fail.${NC}"
fi

echo ""
echo "📦 Installing dependencies..."

# Install Node dependencies
echo "Installing Node.js dependencies..."
npm install

# Install Python dependencies
echo "Installing Python dependencies..."
cd python-backend
python3 -m pip install -r requirements.txt

# Install playwright browsers
echo "Installing Playwright browsers..."
python3 -m playwright install chromium
cd ..

echo ""
echo "🔧 Setting up Python backend..."

# Create necessary directories
mkdir -p python-backend/logs
mkdir -p python-backend/data

echo ""
echo "🎨 Building Electron app..."

# Build the app
npm run build:mac

echo ""

# Check if build succeeded
if [ -d "dist/mac" ] || [ -d "dist/mac-arm64" ]; then
    echo -e "${GREEN}✅ Build successful!${NC}"
    echo ""
    echo "📁 Build location:"
    ls -la dist/*.dmg 2>/dev/null || echo "  (Check dist/ directory)"
    echo ""
    echo "🚀 To run the app:"
    echo "   open dist/mac/Agent7.app"
    echo ""
    echo "📦 To create DMG installer:"
    echo "   npm run dist"
else
    echo -e "${RED}❌ Build failed${NC}"
    echo "Check the error messages above"
    exit 1
fi

echo ""
echo "✨ Build complete!"