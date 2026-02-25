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
                    f"Timeout after {timeout_ms}ms (attempt {attempt + 1})"
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
