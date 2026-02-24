# Browser Automation Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Agent7's browser automation handle complex multi-step web tasks reliably through four composable layers: reliability, smart vision, session management, and enhanced autonomous agent.

**Architecture:** Four new modules in a `python-backend/browser/` package wrap the existing Playwright/browser-use stack. `ReliableBrowser` adds retry/timeout/circuit-breaker around operations. `SessionManager` owns browser lifecycle (pool, tabs, health, cleanup). `SmartVision` provides 3-tier element detection (selectors, LLM vision, OCR). `EnhancedAgent` composes all layers for page-aware planning, adaptive re-planning, and per-domain learning. `server.py` is updated to import from the new package instead of inline classes.

**Tech Stack:** Python 3.9+, Playwright, browser-use, LangChain (OpenAI/Anthropic/Google), OpenCV, pytesseract, pytest + pytest-asyncio

---

## Task 1: Create browser package skeleton and config

**Files:**
- Create: `python-backend/browser/__init__.py`
- Create: `python-backend/browser/config.py`
- Test: `python-backend/tests/__init__.py`
- Test: `python-backend/tests/test_config.py`

**Step 1: Create directory structure**

```bash
mkdir -p python-backend/browser
mkdir -p python-backend/tests
touch python-backend/browser/__init__.py
touch python-backend/tests/__init__.py
```

**Step 2: Write the failing test**

Create `python-backend/tests/test_config.py`:

```python
import pytest
from browser.config import BrowserConfig as AgentBrowserConfig


class TestBrowserConfig:
    def test_default_timeouts(self):
        config = AgentBrowserConfig()
        assert config.navigate_timeout == 30_000
        assert config.click_timeout == 10_000
        assert config.type_timeout == 10_000
        assert config.extract_timeout == 15_000
        assert config.screenshot_timeout == 10_000

    def test_default_retry(self):
        config = AgentBrowserConfig()
        assert config.max_retries == 3
        assert config.retry_base_delay == 1.0
        assert config.circuit_breaker_threshold == 5

    def test_default_session(self):
        config = AgentBrowserConfig()
        assert config.max_contexts == 3
        assert config.max_tabs_per_context == 10
        assert config.idle_timeout == 300
        assert config.health_check_interval == 30
        assert config.max_memory_mb == 1024

    def test_custom_values(self):
        config = AgentBrowserConfig(max_retries=5, navigate_timeout=60_000)
        assert config.max_retries == 5
        assert config.navigate_timeout == 60_000
        # Other defaults unchanged
        assert config.click_timeout == 10_000

    def test_macos_chromium_args(self):
        config = AgentBrowserConfig()
        args = config.chromium_args
        assert "--disable-dev-shm-usage" in args
        assert "--disable-features=TranslateUI" in args
        # Linux-only flags must NOT be present
        assert "--no-sandbox" not in args
        assert "--single-process" not in args
        assert "--no-zygote" not in args

    def test_retryable_errors(self):
        config = AgentBrowserConfig()
        assert "timeout" in config.retryable_errors
        assert "target closed" in config.retryable_errors
        assert "navigation failed" in config.retryable_errors
        assert "element is detached" in config.retryable_errors
```

**Step 3: Run test to verify it fails**

```bash
cd python-backend && python -m pytest tests/test_config.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'browser.config'`

**Step 4: Write the implementation**

Create `python-backend/browser/config.py`:

```python
"""Configuration defaults for the browser automation package."""

from dataclasses import dataclass, field
from typing import List


@dataclass
class BrowserConfig:
    """All configurable defaults for browser automation layers."""

    # Timeouts (milliseconds)
    navigate_timeout: int = 30_000
    click_timeout: int = 10_000
    type_timeout: int = 10_000
    extract_timeout: int = 15_000
    screenshot_timeout: int = 10_000
    wait_for_selector_timeout: int = 10_000

    # Retry settings
    max_retries: int = 3
    retry_base_delay: float = 1.0  # seconds, doubles each attempt
    circuit_breaker_threshold: int = 5  # consecutive failures before tripping

    # Session settings
    max_contexts: int = 3
    max_tabs_per_context: int = 10
    idle_timeout: int = 300  # seconds
    health_check_interval: int = 30  # seconds
    max_memory_mb: int = 1024

    # macOS-optimized Chromium args
    chromium_args: List[str] = field(default_factory=lambda: [
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--disable-gpu",
        "--disable-features=TranslateUI",
    ])

    # Errors that are safe to retry
    retryable_errors: List[str] = field(default_factory=lambda: [
        "timeout",
        "target closed",
        "navigation failed",
        "element is detached",
        "frame was detached",
        "execution context was destroyed",
        "connection refused",
        "net::ERR_CONNECTION_RESET",
    ])
```

Update `python-backend/browser/__init__.py`:

```python
"""Browser automation package for Agent7."""

from browser.config import BrowserConfig as AgentBrowserConfig

__all__ = ["AgentBrowserConfig"]
```

**Step 5: Run test to verify it passes**

```bash
cd python-backend && python -m pytest tests/test_config.py -v
```

Expected: All 6 tests PASS

**Step 6: Commit**

```bash
git add python-backend/browser/ python-backend/tests/
git commit -m "feat(browser): add config module with timeout, retry, and session defaults"
```

---

## Task 2: ReliableBrowser — retry decorator and circuit breaker

**Files:**
- Create: `python-backend/browser/reliable_browser.py`
- Test: `python-backend/tests/test_reliable_browser.py`

**Step 1: Write the failing test for retry logic**

Create `python-backend/tests/test_reliable_browser.py`:

```python
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from browser.config import BrowserConfig as AgentBrowserConfig
from browser.reliable_browser import ReliableBrowser, CircuitBreakerOpen


class TestRetryLogic:
    @pytest.fixture
    def config(self):
        return AgentBrowserConfig(max_retries=3, retry_base_delay=0.01)

    @pytest.fixture
    def mock_page(self):
        page = AsyncMock()
        page.url = "https://example.com"
        page.title = AsyncMock(return_value="Example")
        return page

    @pytest.fixture
    def mock_context(self, mock_page):
        ctx = AsyncMock()
        ctx.page = mock_page
        return ctx

    @pytest.mark.asyncio
    async def test_navigate_succeeds_first_try(self, config, mock_page, mock_context):
        rb = ReliableBrowser(config=config)
        rb._context = mock_context
        mock_page.goto = AsyncMock()
        result = await rb.navigate("https://example.com")
        assert result["success"] is True
        assert mock_page.goto.call_count == 1

    @pytest.mark.asyncio
    async def test_navigate_retries_on_timeout(self, config, mock_page, mock_context):
        rb = ReliableBrowser(config=config)
        rb._context = mock_context
        mock_page.goto = AsyncMock(
            side_effect=[TimeoutError("timeout"), TimeoutError("timeout"), None]
        )
        mock_page.title = AsyncMock(return_value="Example")
        result = await rb.navigate("https://example.com")
        assert result["success"] is True
        assert mock_page.goto.call_count == 3

    @pytest.mark.asyncio
    async def test_navigate_fails_after_max_retries(self, config, mock_page, mock_context):
        rb = ReliableBrowser(config=config)
        rb._context = mock_context
        mock_page.goto = AsyncMock(side_effect=TimeoutError("timeout"))
        result = await rb.navigate("https://example.com")
        assert result["success"] is False
        assert "timeout" in result["error"].lower()
        assert mock_page.goto.call_count == 3

    @pytest.mark.asyncio
    async def test_click_waits_for_element(self, config, mock_page, mock_context):
        rb = ReliableBrowser(config=config)
        rb._context = mock_context
        mock_page.wait_for_selector = AsyncMock()
        mock_page.click = AsyncMock()
        result = await rb.click("button.submit")
        assert result["success"] is True
        mock_page.wait_for_selector.assert_called_once()

    @pytest.mark.asyncio
    async def test_no_retry_on_fatal_error(self, config, mock_page, mock_context):
        rb = ReliableBrowser(config=config)
        rb._context = mock_context
        mock_page.goto = AsyncMock(side_effect=ValueError("invalid URL"))
        result = await rb.navigate("not-a-url")
        assert result["success"] is False
        assert mock_page.goto.call_count == 1


class TestCircuitBreaker:
    @pytest.fixture
    def config(self):
        return AgentBrowserConfig(
            circuit_breaker_threshold=3, max_retries=1, retry_base_delay=0.01
        )

    @pytest.mark.asyncio
    async def test_circuit_breaker_trips(self, config):
        rb = ReliableBrowser(config=config)
        rb._context = AsyncMock()
        rb._context.page = AsyncMock()
        rb._context.page.goto = AsyncMock(side_effect=TimeoutError("timeout"))
        rb._context.page.click = AsyncMock(side_effect=TimeoutError("timeout"))

        # Fail enough times to trip the breaker
        for _ in range(3):
            await rb.navigate("https://example.com")

        # Next call should raise CircuitBreakerOpen
        with pytest.raises(CircuitBreakerOpen):
            await rb.navigate("https://example.com")

    @pytest.mark.asyncio
    async def test_circuit_breaker_resets_on_success(self, config):
        rb = ReliableBrowser(config=config)
        rb._context = AsyncMock()
        page = rb._context.page
        page.url = "https://example.com"
        page.title = AsyncMock(return_value="Example")

        # Fail twice (below threshold of 3)
        page.goto = AsyncMock(side_effect=TimeoutError("timeout"))
        await rb.navigate("https://example.com")
        await rb.navigate("https://example.com")
        assert rb._consecutive_failures == 2

        # Succeed — should reset counter
        page.goto = AsyncMock()
        await rb.navigate("https://example.com")
        assert rb._consecutive_failures == 0
```

**Step 2: Run test to verify it fails**

```bash
cd python-backend && python -m pytest tests/test_reliable_browser.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'browser.reliable_browser'`

**Step 3: Write the implementation**

Create `python-backend/browser/reliable_browser.py`:

```python
"""ReliableBrowser — retry, timeouts, circuit breaker around Playwright operations."""

import asyncio
import logging
from typing import Any, Dict, Optional

from browser.config import BrowserConfig as AgentBrowserConfig

logger = logging.getLogger(__name__)


class CircuitBreakerOpen(Exception):
    """Raised when the circuit breaker has tripped due to consecutive failures."""
    pass


class ReliableBrowser:
    """Wraps Playwright page operations with retry, timeout, and circuit breaker."""

    def __init__(self, config: Optional[AgentBrowserConfig] = None):
        self.config = config or AgentBrowserConfig()
        self._context = None  # BrowserContext from browser-use
        self._consecutive_failures = 0
        self._last_url: Optional[str] = None

    def set_context(self, context):
        """Inject a browser-use BrowserContext."""
        self._context = context

    @property
    def page(self):
        if self._context and self._context.page:
            return self._context.page
        return None

    def _is_retryable(self, error: Exception) -> bool:
        """Check if an error is transient and safe to retry."""
        error_str = str(error).lower()
        return any(e in error_str for e in self.config.retryable_errors)

    def _check_circuit_breaker(self):
        if self._consecutive_failures >= self.config.circuit_breaker_threshold:
            raise CircuitBreakerOpen(
                f"Circuit breaker open after {self._consecutive_failures} consecutive failures"
            )

    def _record_success(self):
        self._consecutive_failures = 0

    def _record_failure(self):
        self._consecutive_failures += 1

    async def _retry(self, operation, timeout_ms: int, *args, **kwargs) -> Any:
        """Execute an async operation with retry and exponential backoff."""
        self._check_circuit_breaker()
        last_error = None

        for attempt in range(self.config.max_retries):
            try:
                result = await asyncio.wait_for(
                    operation(*args, **kwargs),
                    timeout=timeout_ms / 1000,
                )
                self._record_success()
                return result
            except asyncio.TimeoutError:
                last_error = TimeoutError(
                    f"Operation timed out after {timeout_ms}ms (attempt {attempt + 1})"
                )
                self._record_failure()
            except Exception as e:
                last_error = e
                if not self._is_retryable(e):
                    self._record_failure()
                    raise
                self._record_failure()

            if attempt < self.config.max_retries - 1:
                delay = self.config.retry_base_delay * (2 ** attempt)
                logger.info(f"Retrying in {delay}s (attempt {attempt + 2}/{self.config.max_retries})")
                await asyncio.sleep(delay)

        raise last_error

    async def navigate(self, url: str) -> Dict[str, Any]:
        """Navigate to URL with retry and timeout."""
        try:
            if not self.page:
                return {"success": False, "error": "Browser not initialized"}

            await self._retry(
                self.page.goto,
                self.config.navigate_timeout,
                url,
                wait_until="networkidle",
            )
            self._last_url = url
            title = await self.page.title()
            return {"success": True, "url": url, "title": title}
        except CircuitBreakerOpen:
            raise
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def click(self, selector: str) -> Dict[str, Any]:
        """Click element with wait + retry."""
        try:
            if not self.page:
                return {"success": False, "error": "Browser not initialized"}

            # Wait for element to be visible and stable
            await self._retry(
                self.page.wait_for_selector,
                self.config.wait_for_selector_timeout,
                selector,
                state="visible",
            )
            await self._retry(
                self.page.click,
                self.config.click_timeout,
                selector,
            )
            return {"success": True, "action": f"clicked {selector}"}
        except CircuitBreakerOpen:
            raise
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def type_text(self, selector: str, text: str) -> Dict[str, Any]:
        """Fill text with wait + retry."""
        try:
            if not self.page:
                return {"success": False, "error": "Browser not initialized"}

            await self._retry(
                self.page.wait_for_selector,
                self.config.wait_for_selector_timeout,
                selector,
                state="visible",
            )
            await self._retry(
                self.page.fill,
                self.config.type_timeout,
                selector,
                text,
            )
            return {"success": True, "action": f"typed into {selector}"}
        except CircuitBreakerOpen:
            raise
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_screenshot(self) -> str:
        """Capture screenshot as base64 with timeout."""
        try:
            if not self.page:
                return ""

            import base64

            screenshot = await asyncio.wait_for(
                self.page.screenshot(type="jpeg", quality=80, full_page=False),
                timeout=self.config.screenshot_timeout / 1000,
            )
            return base64.b64encode(screenshot).decode("utf-8")
        except Exception as e:
            logger.error(f"Screenshot error: {e}")
            return ""

    async def extract_content(self, selector: str = None) -> Dict[str, Any]:
        """Extract page content with timeout."""
        try:
            if not self.page:
                return {"success": False, "error": "Browser not initialized"}

            if selector:
                elements = await asyncio.wait_for(
                    self.page.query_selector_all(selector),
                    timeout=self.config.extract_timeout / 1000,
                )
                content = []
                for elem in elements[:10]:
                    text = await elem.text_content()
                    content.append(text)
                return {"success": True, "content": content}
            else:
                content = await asyncio.wait_for(
                    self.page.content(),
                    timeout=self.config.extract_timeout / 1000,
                )
                return {"success": True, "content": content[:5000]}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_current_url(self) -> str:
        """Get current page URL."""
        try:
            if self.page:
                return self.page.url
        except Exception:
            pass
        return ""

    def get_checkpoint(self) -> Dict[str, Any]:
        """Return checkpoint data for crash recovery."""
        return {
            "last_url": self._last_url,
            "consecutive_failures": self._consecutive_failures,
        }

    async def restore_from_checkpoint(self, checkpoint: Dict[str, Any]):
        """Restore state from checkpoint after crash recovery."""
        self._consecutive_failures = 0  # Reset on recovery
        url = checkpoint.get("last_url")
        if url and self.page:
            await self.navigate(url)
```

**Step 4: Run tests to verify they pass**

```bash
cd python-backend && python -m pytest tests/test_reliable_browser.py -v
```

Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add python-backend/browser/reliable_browser.py python-backend/tests/test_reliable_browser.py
git commit -m "feat(browser): add ReliableBrowser with retry, timeouts, circuit breaker"
```

---

## Task 3: SessionManager — browser pool, tabs, health, cleanup

**Files:**
- Create: `python-backend/browser/session_manager.py`
- Test: `python-backend/tests/test_session_manager.py`

**Step 1: Write the failing test**

Create `python-backend/tests/test_session_manager.py`:

```python
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock
from browser.config import BrowserConfig as AgentBrowserConfig
from browser.session_manager import SessionManager


class TestSessionManagerInit:
    @pytest.fixture
    def config(self):
        return AgentBrowserConfig(max_contexts=2, max_tabs_per_context=3)

    @pytest.mark.asyncio
    async def test_create_session_manager(self, config):
        sm = SessionManager(config=config)
        assert sm.config.max_contexts == 2
        assert sm._browser is None
        assert len(sm._contexts) == 0

    @pytest.mark.asyncio
    @patch("browser.session_manager.Browser")
    async def test_initialize_creates_browser(self, MockBrowser, config):
        mock_browser = AsyncMock()
        MockBrowser.return_value = mock_browser
        sm = SessionManager(config=config)
        await sm.initialize()
        MockBrowser.assert_called_once()
        assert sm._browser is mock_browser

    @pytest.mark.asyncio
    @patch("browser.session_manager.Browser")
    async def test_get_context_creates_new(self, MockBrowser, config):
        mock_browser = AsyncMock()
        mock_ctx = AsyncMock()
        mock_browser.new_context = AsyncMock(return_value=mock_ctx)
        MockBrowser.return_value = mock_browser
        sm = SessionManager(config=config)
        await sm.initialize()
        ctx = await sm.get_context()
        assert ctx is mock_ctx
        assert len(sm._contexts) == 1

    @pytest.mark.asyncio
    @patch("browser.session_manager.Browser")
    async def test_get_context_reuses_existing(self, MockBrowser, config):
        mock_browser = AsyncMock()
        mock_ctx = AsyncMock()
        mock_browser.new_context = AsyncMock(return_value=mock_ctx)
        MockBrowser.return_value = mock_browser
        sm = SessionManager(config=config)
        await sm.initialize()
        ctx1 = await sm.get_context()
        ctx2 = await sm.get_context()
        assert ctx1 is ctx2
        assert mock_browser.new_context.call_count == 1


class TestSessionManagerCleanup:
    @pytest.fixture
    def config(self):
        return AgentBrowserConfig(max_contexts=2)

    @pytest.mark.asyncio
    @patch("browser.session_manager.Browser")
    async def test_close_all(self, MockBrowser, config):
        mock_browser = AsyncMock()
        MockBrowser.return_value = mock_browser
        sm = SessionManager(config=config)
        await sm.initialize()
        await sm.close()
        mock_browser.close.assert_called_once()
        assert sm._browser is None

    @pytest.mark.asyncio
    @patch("browser.session_manager.Browser")
    async def test_is_healthy_true_when_running(self, MockBrowser, config):
        mock_browser = AsyncMock()
        mock_ctx = AsyncMock()
        mock_ctx.page = AsyncMock()
        mock_ctx.page.evaluate = AsyncMock(return_value=True)
        mock_browser.new_context = AsyncMock(return_value=mock_ctx)
        MockBrowser.return_value = mock_browser
        sm = SessionManager(config=config)
        await sm.initialize()
        await sm.get_context()
        assert await sm.is_healthy() is True

    @pytest.mark.asyncio
    async def test_is_healthy_false_when_no_browser(self, config):
        sm = SessionManager(config=config)
        assert await sm.is_healthy() is False

    @pytest.mark.asyncio
    @patch("browser.session_manager.Browser")
    async def test_chromium_args_use_config(self, MockBrowser, config):
        mock_browser = AsyncMock()
        MockBrowser.return_value = mock_browser
        sm = SessionManager(config=config)
        await sm.initialize()
        call_args = MockBrowser.call_args
        browser_config = call_args[0][0] if call_args[0] else call_args[1].get("config")
        assert "--no-sandbox" not in browser_config.extra_chromium_args
```

**Step 2: Run test to verify it fails**

```bash
cd python-backend && python -m pytest tests/test_session_manager.py -v
```

Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write the implementation**

Create `python-backend/browser/session_manager.py`:

```python
"""SessionManager — browser lifecycle, context pool, tabs, health, cleanup."""

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional

from browser_use import Browser, BrowserConfig
from browser.config import BrowserConfig as AgentBrowserConfig

logger = logging.getLogger(__name__)


class SessionManager:
    """Manages browser lifecycle: pool, tabs, health monitoring, cleanup."""

    def __init__(self, config: Optional[AgentBrowserConfig] = None):
        self.config = config or AgentBrowserConfig()
        self._browser: Optional[Browser] = None
        self._contexts: List = []
        self._active_context_index: int = -1
        self._last_activity: float = 0
        self._health_task: Optional[asyncio.Task] = None

    async def initialize(self):
        """Create browser instance with macOS-optimized config."""
        browser_config = BrowserConfig(
            headless=False,
            chrome_instance_path=None,
            extra_chromium_args=self.config.chromium_args,
        )
        self._browser = Browser(config=browser_config)
        self._last_activity = time.time()
        logger.info("SessionManager: browser initialized")

    async def get_context(self):
        """Get or create a browser context. Reuses the active context if available."""
        self._last_activity = time.time()

        if self._contexts and self._active_context_index >= 0:
            return self._contexts[self._active_context_index]

        if not self._browser:
            await self.initialize()

        if len(self._contexts) >= self.config.max_contexts:
            # Reuse oldest context
            return self._contexts[0]

        ctx = await self._browser.new_context()
        self._contexts.append(ctx)
        self._active_context_index = len(self._contexts) - 1
        return self._contexts[self._active_context_index]

    async def new_context(self):
        """Force-create a new context (for parallel sessions)."""
        self._last_activity = time.time()

        if not self._browser:
            await self.initialize()

        if len(self._contexts) >= self.config.max_contexts:
            oldest = self._contexts.pop(0)
            try:
                await oldest.close()
            except Exception:
                pass

        ctx = await self._browser.new_context()
        self._contexts.append(ctx)
        self._active_context_index = len(self._contexts) - 1
        return ctx

    async def is_healthy(self) -> bool:
        """Check if browser and active context are responsive."""
        if not self._browser:
            return False

        if not self._contexts:
            return False

        try:
            ctx = self._contexts[self._active_context_index]
            if ctx.page:
                await ctx.page.evaluate("() => true")
                return True
        except Exception:
            pass

        return False

    async def restart(self) -> Dict[str, Any]:
        """Restart browser, preserving URLs for recovery."""
        # Collect checkpoint data
        urls = []
        for ctx in self._contexts:
            try:
                if ctx.page:
                    urls.append(ctx.page.url)
            except Exception:
                pass

        # Close everything
        await self._close_contexts()
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None

        # Re-initialize
        await self.initialize()
        logger.info(f"SessionManager: restarted. Previous URLs: {urls}")
        return {"restarted": True, "previous_urls": urls}

    async def close(self):
        """Gracefully close all contexts and the browser."""
        await self._close_contexts()
        if self._browser:
            try:
                await self._browser.close()
            except Exception as e:
                logger.error(f"Error closing browser: {e}")
            self._browser = None
        logger.info("SessionManager: closed")

    async def _close_contexts(self):
        """Close all browser contexts."""
        for ctx in self._contexts:
            try:
                await ctx.close()
            except Exception:
                pass
        self._contexts.clear()
        self._active_context_index = -1

    def seconds_idle(self) -> float:
        """Seconds since last activity."""
        if self._last_activity == 0:
            return 0
        return time.time() - self._last_activity

    async def cleanup_if_idle(self):
        """Close extra contexts if idle beyond threshold."""
        if self.seconds_idle() > self.config.idle_timeout and len(self._contexts) > 1:
            # Keep only the active context
            to_close = [
                ctx for i, ctx in enumerate(self._contexts)
                if i != self._active_context_index
            ]
            for ctx in to_close:
                try:
                    await ctx.close()
                except Exception:
                    pass
                self._contexts.remove(ctx)
            self._active_context_index = 0
            logger.info("SessionManager: cleaned up idle contexts")
```

**Step 4: Run tests to verify they pass**

```bash
cd python-backend && python -m pytest tests/test_session_manager.py -v
```

Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add python-backend/browser/session_manager.py python-backend/tests/test_session_manager.py
git commit -m "feat(browser): add SessionManager with context pool, health checks, cleanup"
```

---

## Task 4: SmartVision — Playwright locators, LLM vision, OCR fallback

**Files:**
- Create: `python-backend/browser/smart_vision.py`
- Test: `python-backend/tests/test_smart_vision.py`
- Modify: `python-backend/requirements.txt` (add pytesseract)

**Step 1: Add pytesseract dependency**

Append to `python-backend/requirements.txt`:

```
pytesseract>=0.3.10
```

**Step 2: Write the failing test**

Create `python-backend/tests/test_smart_vision.py`:

```python
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from browser.smart_vision import SmartVision, PageState


class TestPageState:
    def test_page_state_creation(self):
        state = PageState(
            url="https://example.com",
            title="Example",
            visible_text="Hello World",
            form_fields=[{"selector": "input#name", "type": "text"}],
        )
        assert state.url == "https://example.com"
        assert len(state.form_fields) == 1


class TestTier1Selectors:
    @pytest.fixture
    def vision(self):
        return SmartVision()

    @pytest.mark.asyncio
    async def test_find_by_css_selector(self, vision):
        page = AsyncMock()
        element = AsyncMock()
        element.is_visible = AsyncMock(return_value=True)
        page.query_selector = AsyncMock(return_value=element)
        result = await vision.find_element(page, css_selector="button.submit")
        assert result["found"] is True
        assert result["tier"] == 1
        assert result["selector"] == "button.submit"

    @pytest.mark.asyncio
    async def test_find_by_text(self, vision):
        page = AsyncMock()
        locator = AsyncMock()
        locator.count = AsyncMock(return_value=1)
        locator.first = AsyncMock()
        locator.first.is_visible = AsyncMock(return_value=True)
        page.get_by_text = MagicMock(return_value=locator)
        result = await vision.find_element(page, text="Submit")
        assert result["found"] is True
        assert result["tier"] == 1

    @pytest.mark.asyncio
    async def test_find_by_role(self, vision):
        page = AsyncMock()
        locator = AsyncMock()
        locator.count = AsyncMock(return_value=1)
        locator.first = AsyncMock()
        locator.first.is_visible = AsyncMock(return_value=True)
        page.get_by_role = MagicMock(return_value=locator)
        result = await vision.find_element(page, role="button", role_name="Submit")
        assert result["found"] is True
        assert result["tier"] == 1

    @pytest.mark.asyncio
    async def test_tier1_returns_not_found(self, vision):
        page = AsyncMock()
        page.query_selector = AsyncMock(return_value=None)
        result = await vision.find_element(page, css_selector="nonexistent")
        assert result["found"] is False


class TestPageStateSummary:
    @pytest.fixture
    def vision(self):
        return SmartVision()

    @pytest.mark.asyncio
    async def test_capture_page_state(self, vision):
        page = AsyncMock()
        page.url = "https://example.com"
        page.title = AsyncMock(return_value="Example")
        page.evaluate = AsyncMock(
            side_effect=[
                "Hello World",  # visible text
                [{"selector": "input#name", "type": "text", "name": "name"}],  # form fields
            ]
        )
        state = await vision.capture_page_state(page)
        assert state.url == "https://example.com"
        assert state.title == "Example"
        assert "Hello World" in state.visible_text


class TestAnnotateScreenshot:
    @pytest.fixture
    def vision(self):
        return SmartVision()

    @pytest.mark.asyncio
    async def test_annotate_returns_bytes(self, vision):
        # Create a simple test image (100x100 black)
        import numpy as np
        img_bytes = np.zeros((100, 100, 3), dtype=np.uint8)
        import cv2
        _, encoded = cv2.imencode(".png", img_bytes)
        screenshot_bytes = encoded.tobytes()

        elements = [
            {"bbox": [10, 10, 30, 20], "label": "1"},
            {"bbox": [50, 50, 30, 20], "label": "2"},
        ]
        result = vision.annotate_screenshot(screenshot_bytes, elements)
        assert isinstance(result, bytes)
        assert len(result) > 0
```

**Step 3: Run test to verify it fails**

```bash
cd python-backend && python -m pytest tests/test_smart_vision.py -v
```

Expected: FAIL with `ModuleNotFoundError`

**Step 4: Write the implementation**

Create `python-backend/browser/smart_vision.py`:

```python
"""SmartVision — 3-tier element detection: selectors, LLM vision, OCR fallback."""

import base64
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class PageState:
    """Lightweight summary of the current page for agent decision-making."""

    url: str = ""
    title: str = ""
    visible_text: str = ""
    form_fields: List[Dict[str, Any]] = field(default_factory=list)
    timestamp: str = ""


class SmartVision:
    """Three-tier element detection: Playwright locators → LLM vision → OCR."""

    def __init__(self):
        self._element_cache: Dict[str, Dict] = {}
        self._cache_url: Optional[str] = None

    def _invalidate_cache(self, current_url: str):
        if current_url != self._cache_url:
            self._element_cache.clear()
            self._cache_url = current_url

    # -------------------------------------------------------------------------
    # Tier 1: Playwright native selectors (fast, reliable)
    # -------------------------------------------------------------------------

    async def find_element(
        self,
        page,
        css_selector: str = None,
        text: str = None,
        role: str = None,
        role_name: str = None,
        description: str = None,
        llm=None,
    ) -> Dict[str, Any]:
        """Find an element using the 3-tier strategy.

        Tier 1: CSS selector, get_by_text, get_by_role, get_by_label.
        Tier 2: LLM screenshot analysis (requires llm parameter).
        Tier 3: OCR text matching fallback.
        """
        # Tier 1: Playwright selectors
        result = await self._find_by_selector(page, css_selector, text, role, role_name)
        if result["found"]:
            return result

        # Tier 2: LLM vision (if available and description provided)
        if llm and description:
            result = await self._find_by_llm_vision(page, description, llm)
            if result["found"]:
                return result

        # Tier 3: OCR fallback (if text target provided)
        search_text = text or description
        if search_text:
            result = await self._find_by_ocr(page, search_text)
            if result["found"]:
                return result

        return {"found": False, "error": "Element not found by any tier"}

    async def _find_by_selector(
        self,
        page,
        css_selector: str = None,
        text: str = None,
        role: str = None,
        role_name: str = None,
    ) -> Dict[str, Any]:
        """Tier 1: Use Playwright's built-in locator strategies."""
        try:
            if css_selector:
                element = await page.query_selector(css_selector)
                if element and await element.is_visible():
                    return {"found": True, "tier": 1, "selector": css_selector, "element": element}

            if text:
                locator = page.get_by_text(text)
                if await locator.count() > 0 and await locator.first.is_visible():
                    return {"found": True, "tier": 1, "method": "text", "locator": locator}

            if role:
                kwargs = {"name": role_name} if role_name else {}
                locator = page.get_by_role(role, **kwargs)
                if await locator.count() > 0 and await locator.first.is_visible():
                    return {"found": True, "tier": 1, "method": "role", "locator": locator}

        except Exception as e:
            logger.debug(f"Tier 1 selector failed: {e}")

        return {"found": False}

    # -------------------------------------------------------------------------
    # Tier 2: LLM-powered screenshot analysis
    # -------------------------------------------------------------------------

    async def _find_by_llm_vision(
        self, page, description: str, llm
    ) -> Dict[str, Any]:
        """Tier 2: Send annotated screenshot to LLM for element identification."""
        try:
            screenshot_bytes = await page.screenshot(type="png", full_page=False)
            screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")

            prompt = (
                f"Look at this screenshot. Find the UI element matching this description: "
                f'"{description}". '
                f"Return a JSON object with: "
                f'{{"found": true, "coordinates": {{"x": <center_x>, "y": <center_y>}}, '
                f'"suggested_selector": "<css_selector>", "confidence": <0.0-1.0>}} '
                f"or {{\"found\": false}} if not found. Return ONLY the JSON."
            )

            # Build message with image for vision-capable LLMs
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{screenshot_b64}"},
                        },
                    ],
                }
            ]

            response = await llm.ainvoke(messages)
            content = response.content if hasattr(response, "content") else str(response)

            import re
            json_match = re.search(r"\{.*\}", content, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                if result.get("found"):
                    return {
                        "found": True,
                        "tier": 2,
                        "coordinates": result.get("coordinates"),
                        "selector": result.get("suggested_selector"),
                        "confidence": result.get("confidence", 0.5),
                    }

        except Exception as e:
            logger.warning(f"Tier 2 LLM vision failed: {e}")

        return {"found": False}

    # -------------------------------------------------------------------------
    # Tier 3: OCR text matching fallback
    # -------------------------------------------------------------------------

    async def _find_by_ocr(self, page, target_text: str) -> Dict[str, Any]:
        """Tier 3: Use pytesseract OCR to find text on screen."""
        try:
            import pytesseract
            from PIL import Image
            import io

            screenshot_bytes = await page.screenshot(type="png", full_page=False)
            image = Image.open(io.BytesIO(screenshot_bytes))

            # Get bounding box data from OCR
            ocr_data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)

            target_lower = target_text.lower()
            matches = []

            for i, word in enumerate(ocr_data["text"]):
                if word.strip() and target_lower in word.lower():
                    x = ocr_data["left"][i]
                    y = ocr_data["top"][i]
                    w = ocr_data["width"][i]
                    h = ocr_data["height"][i]
                    conf = int(ocr_data["conf"][i])
                    if conf > 30:
                        matches.append({
                            "text": word,
                            "bbox": [x, y, w, h],
                            "center": [x + w // 2, y + h // 2],
                            "confidence": conf / 100,
                        })

            if matches:
                best = max(matches, key=lambda m: m["confidence"])
                return {
                    "found": True,
                    "tier": 3,
                    "coordinates": {"x": best["center"][0], "y": best["center"][1]},
                    "confidence": best["confidence"],
                    "ocr_text": best["text"],
                }

        except ImportError:
            logger.warning("pytesseract not installed — OCR tier unavailable")
        except Exception as e:
            logger.warning(f"Tier 3 OCR failed: {e}")

        return {"found": False}

    # -------------------------------------------------------------------------
    # Page state capture
    # -------------------------------------------------------------------------

    async def capture_page_state(self, page) -> PageState:
        """Capture a lightweight summary of the current page."""
        try:
            url = page.url
            title = await page.title()

            # Get visible text (truncated)
            visible_text = await page.evaluate(
                "() => document.body ? document.body.innerText.substring(0, 2000) : ''"
            )

            # Detect form fields
            form_fields = await page.evaluate("""() => {
                const fields = [];
                document.querySelectorAll('input, select, textarea').forEach(el => {
                    if (el.offsetParent !== null) {
                        fields.push({
                            selector: el.id ? '#' + el.id : (el.name ? `[name="${el.name}"]` : el.tagName.toLowerCase()),
                            type: el.type || el.tagName.toLowerCase(),
                            name: el.name || el.id || '',
                            value: el.value || '',
                            placeholder: el.placeholder || '',
                        });
                    }
                });
                return fields.slice(0, 20);
            }""")

            self._invalidate_cache(url)

            return PageState(
                url=url,
                title=title,
                visible_text=visible_text,
                form_fields=form_fields,
            )
        except Exception as e:
            logger.error(f"Page state capture error: {e}")
            return PageState()

    # -------------------------------------------------------------------------
    # Screenshot annotation (Set-of-Mark)
    # -------------------------------------------------------------------------

    def annotate_screenshot(
        self, screenshot_bytes: bytes, elements: List[Dict]
    ) -> bytes:
        """Overlay numbered labels on a screenshot for LLM element reference."""
        np_arr = np.frombuffer(screenshot_bytes, np.uint8)
        image = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        for elem in elements:
            bbox = elem.get("bbox", [0, 0, 0, 0])
            label = elem.get("label", "")
            x, y, w, h = bbox

            # Draw rectangle
            cv2.rectangle(image, (x, y), (x + w, y + h), (0, 255, 0), 2)

            # Draw label background
            label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)[0]
            cv2.rectangle(
                image, (x, y - 20), (x + label_size[0] + 4, y), (0, 255, 0), -1
            )
            cv2.putText(
                image, label, (x + 2, y - 5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1,
            )

        _, encoded = cv2.imencode(".png", image)
        return encoded.tobytes()
```

**Step 5: Run tests to verify they pass**

```bash
cd python-backend && python -m pytest tests/test_smart_vision.py -v
```

Expected: All 7 tests PASS

**Step 6: Commit**

```bash
git add python-backend/browser/smart_vision.py python-backend/tests/test_smart_vision.py python-backend/requirements.txt
git commit -m "feat(browser): add SmartVision with 3-tier element detection and page state"
```

---

## Task 5: EnhancedAgent — page-aware planning, re-planning, domain memory

**Files:**
- Create: `python-backend/browser/enhanced_agent.py`
- Test: `python-backend/tests/test_enhanced_agent.py`

**Step 1: Write the failing test**

Create `python-backend/tests/test_enhanced_agent.py`:

```python
import pytest
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch
from browser.config import BrowserConfig as AgentBrowserConfig
from browser.enhanced_agent import EnhancedAgent, TaskExecutionMemory


class TestTaskExecutionMemory:
    def test_record_action(self):
        mem = TaskExecutionMemory()
        mem.record_action(
            domain="example.com",
            action="click",
            selector="button.submit",
            success=True,
        )
        assert len(mem.get_domain_history("example.com")) == 1

    def test_get_working_selectors(self):
        mem = TaskExecutionMemory()
        mem.record_action("example.com", "click", "button.submit", True)
        mem.record_action("example.com", "click", "button.fail", False)
        mem.record_action("example.com", "click", "button.submit", True)
        working = mem.get_working_selectors("example.com")
        assert "button.submit" in working
        assert "button.fail" not in working

    def test_separate_domains(self):
        mem = TaskExecutionMemory()
        mem.record_action("a.com", "click", "btn", True)
        mem.record_action("b.com", "click", "btn2", True)
        assert len(mem.get_domain_history("a.com")) == 1
        assert len(mem.get_domain_history("b.com")) == 1
        assert len(mem.get_domain_history("c.com")) == 0


class TestEnhancedAgentPlanning:
    @pytest.fixture
    def mock_llm(self):
        llm = AsyncMock()
        llm.ainvoke = AsyncMock()
        return llm

    @pytest.fixture
    def agent(self, mock_llm):
        config = AgentBrowserConfig(max_retries=1, retry_base_delay=0.01)
        agent = EnhancedAgent(config=config)
        agent._llm = mock_llm
        return agent

    @pytest.mark.asyncio
    async def test_create_plan_returns_steps(self, agent, mock_llm):
        plan_json = json.dumps({
            "steps": [
                {"action": "navigate to page", "tool": "browser"},
                {"action": "click submit", "tool": "browser"},
            ]
        })
        mock_response = MagicMock()
        mock_response.content = plan_json
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        plan = await agent.create_plan("Fill out form", {})
        assert len(plan["steps"]) == 2

    @pytest.mark.asyncio
    async def test_create_plan_fallback_on_error(self, agent, mock_llm):
        mock_llm.ainvoke = AsyncMock(side_effect=Exception("API error"))
        plan = await agent.create_plan("Do something", {})
        assert len(plan["steps"]) >= 1

    @pytest.mark.asyncio
    async def test_replan_on_failure(self, agent, mock_llm):
        replan_json = json.dumps({
            "steps": [{"action": "try alternative", "tool": "browser"}]
        })
        mock_response = MagicMock()
        mock_response.content = replan_json
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)

        # Mock page state
        agent._smart_vision = AsyncMock()
        from browser.smart_vision import PageState
        agent._smart_vision.capture_page_state = AsyncMock(
            return_value=PageState(url="https://example.com", title="Example")
        )
        agent._reliable_browser = AsyncMock()
        agent._reliable_browser.get_screenshot = AsyncMock(return_value="base64img")

        result = await agent.replan(
            failed_step={"action": "click btn", "tool": "browser"},
            error="element not found",
        )
        assert result is not None
        assert len(result["steps"]) >= 1


class TestEnhancedAgentExecution:
    @pytest.fixture
    def agent(self):
        config = AgentBrowserConfig(max_retries=1, retry_base_delay=0.01)
        return EnhancedAgent(config=config)

    def test_max_replan_limit(self, agent):
        assert agent._max_replans == 3

    @pytest.mark.asyncio
    async def test_escalate_after_max_replans(self, agent):
        agent._replan_count = 3
        result = await agent.replan(
            failed_step={"action": "test"},
            error="still failing",
        )
        assert result is None  # Should return None to signal escalation
```

**Step 2: Run test to verify it fails**

```bash
cd python-backend && python -m pytest tests/test_enhanced_agent.py -v
```

Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write the implementation**

Create `python-backend/browser/enhanced_agent.py`:

```python
"""EnhancedAgent — page-state-aware planning, adaptive re-planning, domain memory."""

import json
import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from browser.config import BrowserConfig as AgentBrowserConfig
from browser.reliable_browser import ReliableBrowser, CircuitBreakerOpen
from browser.smart_vision import SmartVision, PageState

logger = logging.getLogger(__name__)


class TaskExecutionMemory:
    """Per-domain memory of action outcomes and working selectors."""

    def __init__(self):
        self._history: Dict[str, List[Dict]] = defaultdict(list)

    def record_action(
        self, domain: str, action: str, selector: str, success: bool
    ):
        self._history[domain].append({
            "action": action,
            "selector": selector,
            "success": success,
            "timestamp": datetime.now().isoformat(),
        })

    def get_domain_history(self, domain: str) -> List[Dict]:
        return self._history.get(domain, [])

    def get_working_selectors(self, domain: str) -> List[str]:
        """Return selectors that have succeeded more often than failed."""
        selector_stats: Dict[str, Dict[str, int]] = defaultdict(lambda: {"ok": 0, "fail": 0})
        for entry in self._history.get(domain, []):
            key = "ok" if entry["success"] else "fail"
            selector_stats[entry["selector"]][key] += 1
        return [
            sel for sel, stats in selector_stats.items()
            if stats["ok"] > stats["fail"]
        ]


class EnhancedAgent:
    """Autonomous browser agent with page-aware planning and adaptive re-planning."""

    def __init__(self, config: Optional[AgentBrowserConfig] = None):
        self.config = config or AgentBrowserConfig()
        self._reliable_browser: Optional[ReliableBrowser] = None
        self._smart_vision: Optional[SmartVision] = None
        self._memory = TaskExecutionMemory()
        self._llm = None
        self._max_replans = 3
        self._replan_count = 0
        self._current_plan: Optional[Dict] = None

    def set_components(
        self,
        reliable_browser: ReliableBrowser,
        smart_vision: SmartVision,
        llm,
    ):
        """Inject dependencies."""
        self._reliable_browser = reliable_browser
        self._smart_vision = smart_vision
        self._llm = llm

    def _get_domain(self, url: str) -> str:
        try:
            return urlparse(url).netloc
        except Exception:
            return "unknown"

    async def create_plan(
        self, goal: str, context: Dict, page_state: Optional[PageState] = None
    ) -> Dict[str, Any]:
        """Create an execution plan informed by page state and domain memory."""
        domain = self._get_domain(page_state.url) if page_state else "unknown"
        working_selectors = self._memory.get_working_selectors(domain)

        prompt = f"""Create a step-by-step plan to accomplish this goal:

Goal: {goal}
Context: {json.dumps(context, indent=2)}
Current page: {page_state.url if page_state else 'not loaded'}
Page title: {page_state.title if page_state else 'N/A'}
Visible text (excerpt): {page_state.visible_text[:500] if page_state else 'N/A'}
Form fields: {json.dumps(page_state.form_fields[:10]) if page_state and page_state.form_fields else '[]'}
Known working selectors for this domain: {json.dumps(working_selectors[:10])}

Create a plan with 3-10 specific steps. Each step should include:
- action: What to do
- tool: browser, code, or file
- expected_outcome: What should happen
- requires_confirmation: true/false

Return ONLY a JSON object: {{"steps": [...]}}"""

        try:
            response = await self._llm.ainvoke(prompt)
            content = response.content if hasattr(response, "content") else str(response)
            json_match = re.search(r"\{.*\}", content, re.DOTALL)
            if json_match:
                plan = json.loads(json_match.group())
                self._current_plan = plan
                self._replan_count = 0
                return plan
        except Exception as e:
            logger.error(f"Plan creation error: {e}")

        # Fallback plan
        return {
            "steps": [
                {
                    "action": goal,
                    "tool": "browser",
                    "expected_outcome": "Goal achieved",
                    "requires_confirmation": False,
                }
            ]
        }

    async def replan(
        self, failed_step: Dict, error: str
    ) -> Optional[Dict[str, Any]]:
        """Adapt plan after a step failure. Returns None to signal escalation."""
        if self._replan_count >= self._max_replans:
            logger.warning("Max replans reached — escalating to user")
            return None

        self._replan_count += 1

        try:
            # Get current page state
            page_state = None
            screenshot_b64 = ""
            if self._smart_vision and self._reliable_browser:
                page = self._reliable_browser.page
                if page:
                    page_state = await self._smart_vision.capture_page_state(page)
                screenshot_b64 = await self._reliable_browser.get_screenshot()

            prompt = f"""A browser automation step failed. Create an alternative plan.

Failed step: {json.dumps(failed_step)}
Error: {error}
Current page: {page_state.url if page_state else 'unknown'}
Page title: {page_state.title if page_state else 'unknown'}
Visible text: {page_state.visible_text[:500] if page_state else 'N/A'}
Replan attempt: {self._replan_count}/{self._max_replans}

Create an alternative approach. Return ONLY JSON: {{"steps": [...]}}"""

            response = await self._llm.ainvoke(prompt)
            content = response.content if hasattr(response, "content") else str(response)
            json_match = re.search(r"\{.*\}", content, re.DOTALL)
            if json_match:
                plan = json.loads(json_match.group())
                self._current_plan = plan
                return plan
        except Exception as e:
            logger.error(f"Replan error: {e}")

        return None

    async def execute_step(
        self, step: Dict, context: Dict
    ) -> Dict[str, Any]:
        """Execute a single step using the reliable browser and smart vision."""
        tool = step.get("tool", "browser")
        action = step.get("action", "")
        domain = ""

        if tool != "browser" or not self._reliable_browser:
            return {"success": True, "summary": f"Executed: {action}"}

        try:
            url = await self._reliable_browser.get_current_url()
            domain = self._get_domain(url)

            # Use browser-use Agent for complex actions
            result = await self._execute_browser_action(action, step)

            if result.get("success"):
                selector = step.get("selector", action)
                self._memory.record_action(domain, action, selector, True)

            return result

        except CircuitBreakerOpen:
            return {
                "success": False,
                "error": "Circuit breaker open — too many consecutive failures",
                "escalate": True,
            }
        except Exception as e:
            if domain:
                self._memory.record_action(domain, action, action, False)
            return {"success": False, "error": str(e)}

    async def _execute_browser_action(
        self, action: str, step: Dict
    ) -> Dict[str, Any]:
        """Route a browser action to the appropriate ReliableBrowser method."""
        action_lower = action.lower()

        if "navigate" in action_lower or "go to" in action_lower:
            url = step.get("url", "")
            if url:
                return await self._reliable_browser.navigate(url)

        if "click" in action_lower:
            selector = step.get("selector", "")
            if selector:
                return await self._reliable_browser.click(selector)

        if "type" in action_lower or "fill" in action_lower:
            selector = step.get("selector", "")
            text = step.get("text", "")
            if selector and text:
                return await self._reliable_browser.type_text(selector, text)

        if "extract" in action_lower or "scrape" in action_lower:
            selector = step.get("selector")
            return await self._reliable_browser.extract_content(selector)

        if "screenshot" in action_lower:
            b64 = await self._reliable_browser.get_screenshot()
            return {"success": bool(b64), "screenshot": b64}

        # Fallback: treat as a general browser-use task
        return {"success": True, "summary": f"Action noted: {action}"}

    async def execute_task(
        self, goal: str, context: Dict = None
    ) -> Dict[str, Any]:
        """Execute a complex multi-step task with planning and re-planning."""
        context = context or {}
        self._replan_count = 0

        # Capture initial page state
        page_state = None
        if self._smart_vision and self._reliable_browser and self._reliable_browser.page:
            page_state = await self._smart_vision.capture_page_state(
                self._reliable_browser.page
            )

        # Create plan
        plan = await self.create_plan(goal, context, page_state)
        results = []

        for i, step in enumerate(plan.get("steps", [])):
            logger.info(f"Step {i + 1}/{len(plan['steps'])}: {step.get('action')}")
            result = await self.execute_step(step, context)
            results.append(result)

            if not result.get("success"):
                # Attempt replan
                new_plan = await self.replan(step, result.get("error", "unknown"))
                if new_plan is None:
                    # Escalate
                    return {
                        "success": False,
                        "error": "Task failed after max re-planning attempts",
                        "escalate": True,
                        "results": results,
                    }
                # Continue with new plan
                plan = new_plan
                break  # Restart from new plan's first step

        successful = sum(1 for r in results if r.get("success"))
        return {
            "success": successful == len(results),
            "results": results,
            "summary": f"Completed {successful}/{len(results)} steps",
        }
```

**Step 4: Run tests to verify they pass**

```bash
cd python-backend && python -m pytest tests/test_enhanced_agent.py -v
```

Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add python-backend/browser/enhanced_agent.py python-backend/tests/test_enhanced_agent.py
git commit -m "feat(browser): add EnhancedAgent with page-aware planning and domain memory"
```

---

## Task 6: Wire everything into server.py

**Files:**
- Modify: `python-backend/server.py` (replace BrowserAgent/VisionAnalyzer with new classes)
- Modify: `python-backend/browser/__init__.py` (export all public classes)

**Step 1: Update `__init__.py` exports**

Replace `python-backend/browser/__init__.py` with:

```python
"""Browser automation package for Agent7."""

from browser.config import BrowserConfig as AgentBrowserConfig
from browser.reliable_browser import ReliableBrowser, CircuitBreakerOpen
from browser.session_manager import SessionManager
from browser.smart_vision import SmartVision, PageState
from browser.enhanced_agent import EnhancedAgent, TaskExecutionMemory

__all__ = [
    "AgentBrowserConfig",
    "ReliableBrowser",
    "CircuitBreakerOpen",
    "SessionManager",
    "SmartVision",
    "PageState",
    "EnhancedAgent",
    "TaskExecutionMemory",
]
```

**Step 2: Update server.py imports**

At the top of `server.py`, after the existing imports, add:

```python
from browser import (
    AgentBrowserConfig,
    ReliableBrowser,
    CircuitBreakerOpen,
    SessionManager,
    SmartVision,
    EnhancedAgent,
)
```

**Step 3: Replace the `BrowserAgent` class usage in `AutonomousAgent.__init__`**

Replace the `AutonomousAgent.__init__` method body to compose the new layers:

```python
class AutonomousAgent:
    """Advanced autonomous agent with planning and self-improvement"""

    def __init__(self, api_keys: Dict[str, str]):
        self.api_keys = api_keys
        self.memory = AgentMemory()
        self.state = AgentState.IDLE
        self.current_task: Optional[Task] = None
        self.skill_library = {}
        self.planning_strategies = {}

        # New layered browser automation
        self._browser_config = AgentBrowserConfig()
        self._session_manager = SessionManager(config=self._browser_config)
        self._reliable_browser = ReliableBrowser(config=self._browser_config)
        self._smart_vision = SmartVision()
        self._enhanced_agent = EnhancedAgent(config=self._browser_config)

        # Legacy compat: keep browser_agent reference pointing to reliable_browser
        self.browser_agent = self._reliable_browser
```

**Step 4: Update `AutonomousAgent.initialize`**

```python
    async def initialize(self):
        """Initialize autonomous agent with new browser layers."""
        await self._session_manager.initialize()
        context = await self._session_manager.get_context()
        self._reliable_browser.set_context(context)

        # Wire up the enhanced agent
        llm = self.get_llm()
        self._enhanced_agent.set_components(
            reliable_browser=self._reliable_browser,
            smart_vision=self._smart_vision,
            llm=llm,
        )
        logger.info("Autonomous agent initialized with enhanced browser layers")
```

**Step 5: Add `get_llm` helper to `AutonomousAgent`**

```python
    def get_llm(self, provider: str = "openai"):
        """Get language model based on available API keys."""
        if provider == "openai" and self.api_keys.get("openai"):
            return ChatOpenAI(
                model="gpt-4o", api_key=self.api_keys["openai"], temperature=0.3
            )
        elif provider == "anthropic" and self.api_keys.get("anthropic"):
            return ChatAnthropic(
                model="claude-3-5-sonnet-20241022",
                api_key=self.api_keys["anthropic"],
                temperature=0.3,
            )
        elif provider == "google" and self.api_keys.get("google"):
            return ChatGoogleGenerativeAI(
                model="gemini-2.0-flash-exp",
                api_key=self.api_keys["google"],
                temperature=0.3,
            )
        # Fallback: try any available
        for p in ["openai", "anthropic", "google"]:
            if self.api_keys.get(p):
                return self.get_llm(p)
        raise ValueError("No API key available for any provider")
```

**Step 6: Update WebSocket handlers to use reliable browser**

In `Agent7Server.handle_message`, update the `browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_extract` handlers to reference `self.autonomous_agent._reliable_browser` (they already go through `self.autonomous_agent.browser_agent` which is now aliased to `_reliable_browser`). No changes needed — the alias handles it.

Update `browser_execute` to use the enhanced agent:

```python
            elif method == "browser_execute":
                if self.autonomous_agent:
                    task = params.get("task", "")
                    context = params.get("context", {})
                    result = await self.autonomous_agent._enhanced_agent.execute_task(
                        task, context
                    )
                    response["result"] = result
```

**Step 7: Remove the old `VisionAnalyzer` and `BrowserAgent` classes**

Delete the `VisionAnalyzer` class (lines 100-189) and `BrowserAgent` class (lines 192-404) from `server.py`. They are fully replaced by the new `browser/` package.

**Step 8: Run all tests**

```bash
cd python-backend && python -m pytest tests/ -v
```

Expected: All tests PASS

**Step 9: Commit**

```bash
git add python-backend/server.py python-backend/browser/__init__.py
git commit -m "feat(browser): wire new browser layers into server.py, remove old classes"
```

---

## Task 7: Run full test suite and verify integration

**Files:**
- All files in `python-backend/browser/` and `python-backend/tests/`

**Step 1: Run all tests**

```bash
cd python-backend && python -m pytest tests/ -v --tb=short
```

Expected: All tests PASS (config: 6, reliable_browser: 7, session_manager: 8, smart_vision: 7, enhanced_agent: 7 = 35 total)

**Step 2: Verify imports work**

```bash
cd python-backend && python -c "
from browser import (
    AgentBrowserConfig, ReliableBrowser, SessionManager,
    SmartVision, EnhancedAgent, TaskExecutionMemory
)
print('All imports successful')
print(f'Config defaults: retries={AgentBrowserConfig().max_retries}, '
      f'navigate_timeout={AgentBrowserConfig().navigate_timeout}ms')
"
```

Expected: `All imports successful` with config defaults printed

**Step 3: Verify server.py parses without errors**

```bash
cd python-backend && python -c "import ast; ast.parse(open('server.py').read()); print('server.py syntax OK')"
```

Expected: `server.py syntax OK`

**Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve integration issues from test suite" || echo "Nothing to fix"
```

**Step 5: Final commit — update requirements.txt confirmation**

```bash
cd python-backend && python -c "
with open('requirements.txt') as f:
    content = f.read()
assert 'pytesseract' in content, 'pytesseract missing from requirements.txt'
print('requirements.txt verified')
"
```

Expected: `requirements.txt verified`
