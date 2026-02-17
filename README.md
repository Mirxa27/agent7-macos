# 🤖 Agent7 for macOS

**The most advanced autonomous AI agent for macOS with full browser-use integration, multi-modal inputs, and self-improving capabilities.**

[![macOS](https://img.shields.io/badge/macOS-10.15+-blue.svg)](https://www.apple.com/macos/)
[![Electron](https://img.shields.io/badge/Electron-28+-9cf.svg)](https://electronjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## ✨ Features

### 🤖 Advanced Agentic Capabilities
- **Autonomous Task Planning**: Decomposes complex goals into actionable steps
- **Multi-Agent Orchestration**: Coordinates specialized agents (browser, coder, researcher, planner)
- **Self-Improvement**: Learns from failures and adapts strategies
- **Persistent Memory**: Episodic and semantic memory with context retrieval
- **Workflow Automation**: Create and schedule automated workflows

### 🌐 Full Browser-Use Integration
- **Live Browser Control**: Real-time browser automation with Playwright
- **Vision Capabilities**: AI-powered UI element detection and understanding
- **Autonomous Browsing**: Navigate, click, type, extract data autonomously
- **Screenshot Analysis**: Visual understanding of web pages
- **Session Management**: Multiple browser contexts and profiles

### 🎯 Multi-Modal Input System
- **Voice Input**: Speech-to-text with continuous listening
- **Image Analysis**: Process screenshots and images with AI vision
- **File Processing**: Read code, documents, PDFs, and data files
- **Screen Capture**: Direct macOS screen recording integration

### 🛠️ Advanced Tool Library
- **20+ Built-in Tools**: Web search, code execution, file operations, data analysis
- **Self-Improving**: Tracks success rates and adapts tool selection
- **Custom Tool Creation**: Dynamically create new tools from natural language
- **Tool Composition**: Chain multiple tools together

### 🎨 Native macOS Experience
- **Menu Bar Integration**: Quick access from macOS menu bar
- **Global Shortcuts**: Cmd+Shift+A for quick tasks
- **Native Notifications**: macOS notification center integration
- **Dark Mode**: Full support for macOS dark mode
- **Touch Bar**: Touch Bar support for quick actions

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/Mirxa27/agent7-macos.git
cd agent7-macos

# Run the build script
./scripts/build.sh

# Or manually:
npm install
cd python-backend && pip install -r requirements.txt && python3 -m playwright install chromium
cd ..
npm run build:mac
```

### Running

```bash
# Open the built app
open dist/mac/Agent7.app

# Or run in development mode
npm run dev
```

## 📋 System Requirements

- **macOS**: 10.15 (Catalina) or later
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 2GB free space
- **Python**: 3.9 or later
- **Node.js**: 18 or later

## 🔧 Configuration

### API Keys

Add your API keys in Settings:

- **OpenAI**: For GPT-4o, GPT-4, GPT-3.5-turbo
- **Anthropic**: For Claude 3.5 Sonnet, Claude 3 Opus
- **Google**: For Gemini 2.0 Flash

```
Settings → API Keys
```

### Model Selection

Choose your preferred models:

- **Chat Model**: Primary conversational AI
- **Agent Model**: For autonomous task execution
- **Browser Model**: For browser automation (requires vision)

### Autonomous Mode

Enable autonomous mode to let Agent7:
- Execute tasks without confirmation
- Plan and execute multi-step workflows
- Self-correct when errors occur
- Learn from previous executions

## 🎮 Usage Examples

### 1. Autonomous Web Research

```
User: Research the latest AI developments this week and create a summary

Agent7:
1. Searches web for recent AI news
2. Extracts content from top articles
3. Analyzes and synthesizes information
4. Creates formatted summary document
```

### 2. Complex Browser Automation

```
User: Go to Amazon, search for "wireless headphones", filter by 4+ stars, and get the top 3 results

Agent7:
- Navigates to Amazon
- Searches for headphones
- Applies filters
- Extracts product information
- Presents formatted results
```

### 3. Code Generation & Execution

```
User: Create a Python script that fetches weather data and sends it to my email

Agent7:
- Generates Python code
- Installs required packages
- Tests execution
- Provides usage instructions
```

### 4. File Processing

```
User: Read this PDF and extract all tables

Agent7:
- Loads PDF file
- Extracts text and tables
- Converts to structured data
- Exports to CSV/JSON
```

## 🏗️ Architecture

```
Agent7 macOS App
├── Electron Frontend (UI)
│   ├── Main Process (main.js)
│   ├── Renderer Process (renderer.js)
│   └── Native Integration
├── Python Backend (Agent Core)
│   ├── Autonomous Agent (autonomous task execution)
│   ├── Browser Agent (browser-use integration)
│   ├── Multi-Modal Handler (voice/vision/files)
│   ├── Tool Library (20+ tools)
│   └── Memory System (episodic + semantic)
└── WebSocket Communication
```

## 🔬 Advanced Features

### 1. Task Planning

Agent7 uses hierarchical task planning:

```python
# Example: Complex task decomposition
task = "Book a flight from NYC to London"

plan = {
    "steps": [
        {"action": "Search flight comparison sites", "tool": "browser"},
        {"action": "Extract flight options", "tool": "browser"},
        {"action": "Compare prices and times", "tool": "analysis"},
        {"action": "Select best option", "tool": "decision"},
        {"action": "Fill booking form", "tool": "browser"}
    ]
}
```

### 2. Vision Analysis

Advanced computer vision for UI understanding:

```python
# Detect and interact with UI elements
elements = await vision.detect_ui_elements(screenshot)
button = vision.find_element_by_description("Submit button")
await browser.click(button['center'])
```

### 3. Self-Improvement

Agent7 tracks performance and improves:

```python
# Learning from execution history
if tool.success_rate < 0.7:
    # Analyze failures
    # Try alternative approaches
    # Update tool parameters
```

### 4. Multi-Agent Orchestration

Specialized agents working together:

- **Planner Agent**: Breaks down complex tasks
- **Browser Agent**: Handles web automation
- **Coder Agent**: Writes and executes code
- **Research Agent**: Gathers information
- **File Agent**: Manages file operations

## 🛠️ Development

### Project Structure

```
agent7-macos/
├── src/
│   ├── main.js              # Electron main process
│   ├── renderer.js          # UI logic
│   ├── index.html           # Main UI
│   └── styles.css           # Styling
├── python-backend/
│   ├── server.py            # WebSocket server
│   ├── autonomous_agent.py  # Core agent logic
│   ├── browser_agent.py     # Browser automation
│   ├── multimodal.py        # Multi-modal inputs
│   ├── tools.py             # Tool library
│   └── requirements.txt     # Python deps
├── assets/
│   ├── icon.icns            # App icon
│   └── entitlements.plist   # macOS entitlements
├── scripts/
│   └── build.sh             # Build script
└── package.json             # Node dependencies
```

### Adding Custom Tools

```python
# In tools.py
self.register_tool(
    name="my_custom_tool",
    description="Does something custom",
    parameters={
        "param1": {"type": "string", "description": "First parameter"}
    },
    handler=self._my_custom_tool
)

async def _my_custom_tool(self, param1: str) -> Dict:
    # Tool implementation
    return {"result": f"Processed: {param1}"}
```

### Development Mode

```bash
# Terminal 1: Python backend
cd python-backend
python3 server.py

# Terminal 2: Electron
npm run dev
```

## 🔒 Security

- **Sandboxed Execution**: Python code runs in isolated environment
- **API Key Encryption**: Keys stored in macOS Keychain
- **Permission System**: User confirmation for sensitive actions
- **Network Isolation**: Browser contexts are isolated

## 🐛 Troubleshooting

### Browser Not Starting

```bash
# Reinstall Playwright browsers
python3 -m playwright install chromium --force
```

### Python Backend Won't Connect

```bash
# Check if port 8765 is available
lsof -i :8765

# Kill existing processes
kill $(lsof -t -i:8765)
```

### App Won't Build

```bash
# Clean and rebuild
rm -rf node_modules dist
npm install
npm run build:mac
```

## 📝 License

MIT License - See [LICENSE](LICENSE) file

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 🙏 Acknowledgments

- **browser-use**: Browser automation library
- **Playwright**: Browser control
- **LangChain**: LLM framework
- **Electron**: Desktop app framework
- **Agent Zero**: Original inspiration

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/Mirxa27/agent7-macos/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Mirxa27/agent7-macos/discussions)

---

**Built with ❤️ for the AI community**