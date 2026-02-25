# Browser Automation Upgrade Design

**Date:** 2026-02-25
**Status:** Approved
**Approach:** Layered Enhancement (4 composable layers + AWS Bedrock + multi-agent orchestrator)

## Goal

Make Agent7's browser automation capable of handling complex multi-step web tasks reliably: multi-page forms, dynamic SPAs, data extraction at scale, interactive web apps with modals/iframes/drag-and-drop, and authentication flows.

## Architecture

Four new layers compose on top of the existing `BrowserAgent`:

```
server.py (WebSocket API — updated)
  └── EnhancedAutonomousAgent
        ├── SmartVision (page understanding)
        ├── ReliableBrowser (robust operations)
        │     └── SessionManager (browser lifecycle)
        └── TaskExecutionMemory (per-domain learning)
```

All layers are provider-agnostic — LLM vision calls route through `get_llm()` supporting OpenAI, Anthropic, Google, and AWS Bedrock.

## Layer 1: Reliability Layer

**File:** `python-backend/browser/reliable_browser.py`

Wraps all browser operations with fault tolerance:

- **Retry with exponential backoff** — 3 attempts by default, starting at 1s. Retries on transient errors (timeout, element detached, navigation failed). Does not retry fatal errors (invalid selector, page closed).
- **Operation timeouts** — `navigate`: 30s, `click`: 10s, `type_text`: 10s, `extract_content`: 15s, `screenshot`: 10s. All configurable per-call.
- **Element wait strategies** — Before interaction, wait for element to be present, visible, and stable (not animating). Uses Playwright's `wait_for_selector` with state checks.
- **Crash recovery** — Detect browser crashes (connection reset, target closed). On crash: log state, restart browser via SessionManager, restore last known URL, emit recovery event to frontend.
- **Circuit breaker** — After 5 consecutive operation failures, pause and report to the agent layer for re-planning instead of retrying blindly.

## Layer 2: Smart Vision Layer

**File:** `python-backend/browser/smart_vision.py`

Three-tier element detection replacing the current `VisionAnalyzer`:

- **Tier 1: Playwright selectors (fast, preferred)** — CSS/XPath selectors plus Playwright's `get_by_role`, `get_by_text`, `get_by_label` locators. Used first for all interactions.
- **Tier 2: LLM-powered screenshot analysis** — When selectors fail, take a screenshot and send to the configured LLM: "Identify the element matching [description]. Return coordinates and a suggested CSS selector." Provider-agnostic via existing `get_chat_model()`.
- **Tier 3: OCR + heuristic fallback** — For text-heavy pages or when LLM vision is unavailable, use `pytesseract` OCR to extract text positions. Match target text, return bounding boxes. Combined with OpenCV edge detection for non-text elements.

Additional capabilities:
- **Page state summaries** — Before each action, capture: URL, title, visible text, detected form fields. Feeds into autonomous agent planning.
- **Element annotation** — Overlay numbered labels on screenshots (Set-of-Mark approach) for LLM element references.
- **Location caching** — Cache element positions for current page state. Invalidate on navigation or DOM mutation.

## Layer 3: Session Manager

**File:** `python-backend/browser/session_manager.py`

Owns the browser lifecycle:

- **Browser context pool** — 1 active context (max 3). Reuse across sequential tasks. Each context has its own cookies and storage.
- **Tab management** — Support multiple tabs, track active tab, limit max 10 per context. First-class "open in new tab, extract, close" operations.
- **macOS-optimized Chromium config** — Remove Linux flags (`--no-sandbox`, `--single-process`, `--no-zygote`). Keep `--disable-dev-shm-usage`. Add `--disable-features=TranslateUI`. Configure for Retina displays.
- **Health monitoring** — Check browser health every 30s (process alive, page responsive). Trigger graceful restart with state preservation if unhealthy.
- **Resource cleanup** — Close unused tabs on task completion. Close extra contexts after 5 min idle. Graceful close-all on app shutdown. Force-restart if Chromium exceeds 1GB memory.
- **State persistence** — On crash, save open URLs, cookies, localStorage. On recovery, restore most recent tab state.

## Layer 4: Enhanced Autonomous Agent

**File:** `python-backend/browser/enhanced_agent.py`

Upgraded task planning and execution:

- **Page-state-aware planning** — Agent receives structured page state from SmartVision before each step. Plans actions based on what's on screen, not just expectations. Handles dynamic SPAs, modals, popups.
- **Adaptive re-planning** — On step failure (after reliability retries): take fresh screenshot, send failure context + screenshot to LLM, get alternative plan, continue. Escalate to user after 3 consecutive re-plan failures.
- **Task execution memory** — Record action sequences, outcomes, screenshots at decision points, working selectors per domain. Build per-site knowledge base for future tasks.
- **Complex workflow primitives:**
  - Form filling: detect fields, fill in sequence, handle validation
  - Pagination: detect next/prev, iterate pages
  - Authentication: detect login, fill credentials, handle 2FA (pause for user)
  - Wait conditions: wait for content, network requests, element interactivity

## Layer 5: AWS Bedrock Provider

**File:** `python-backend/server.py` (updated `get_llm()`), `python-backend/requirements.txt`

Adds AWS Bedrock as a fourth LLM provider:

- **Authentication** — User enters AWS Access Key ID, Secret Access Key, and Region in the Agent7 settings UI. Stored alongside existing API keys via the `initialize` WebSocket method.
- **Model selection** — Support any Bedrock model ID (e.g., `anthropic.claude-3-5-sonnet-20241022-v2:0`, `amazon.titan-text-premier-v1:0`, `meta.llama3-70b-instruct-v1:0`). Default to Claude on Bedrock.
- **Integration** — Add `bedrock` case to `get_llm()` using `ChatBedrockConverse` from `langchain-aws`.
- **Vision support** — Bedrock Claude models support vision, so SmartVision Tier 2 works with Bedrock.

## Layer 6: Multi-Agent Orchestrator

**File:** `python-backend/browser/orchestrator.py`

Python-side orchestration to coordinate the 7 specialized agents:

- **Goal decomposition** — Receives a goal, uses LLM to decompose into sub-tasks with type annotations.
- **Agent assignment** — Maps sub-task types to agents: `browser` → EnhancedAgent, `coder` → code execution, `researcher` → LLM analysis, `file_manager` → file operations, `planner` → LLM planning, `executor` → general execution, `reviewer` → LLM verification.
- **Dependency-ordered execution** — Executes sub-tasks in dependency order, tracking completion.
- **Failure handling** — On agent failure: re-assign to a different agent or re-plan the remaining steps.
- **Progress broadcasting** — Sends real-time progress events to all WebSocket clients.
- **New WebSocket method** — `orchestrate_task` for multi-agent workflows. Old `execute_task` remains for backward compatibility.

## File Structure

```
python-backend/
├── browser/                    # NEW package
│   ├── __init__.py
│   ├── config.py               # Configurable defaults
│   ├── reliable_browser.py     # Retry, timeouts, circuit breaker
│   ├── smart_vision.py         # 3-tier element detection
│   ├── session_manager.py      # Browser pool, tabs, health, cleanup
│   ├── enhanced_agent.py       # Page-aware planning, re-planning, memory
│   └── orchestrator.py         # Multi-agent orchestration
├── server.py                   # UPDATED — imports from browser/, Bedrock provider
├── tools.py                    # Unchanged
├── multimodal.py               # Unchanged
└── requirements.txt            # UPDATED — add pytesseract, langchain-aws, boto3
```

## Migration

- Replace `BrowserAgent` and `VisionAnalyzer` in `server.py` with imports from `browser/` package
- All WebSocket API methods (`browser_navigate`, `browser_click`, etc.) continue to work unchanged
- `browser_execute` routes to `EnhancedAgent`
- New `orchestrate_task` WebSocket method for multi-agent workflows
- `get_llm()` gains `bedrock` provider option
- No frontend changes required — same WebSocket protocol (new method is additive)

## New Dependencies

- `pytesseract>=0.3.10` (Python package)
- `tesseract-ocr` (system, via `brew install tesseract` on macOS)
- `langchain-aws>=0.2.0` (Bedrock integration)
- `boto3>=1.34.0` (AWS SDK)
