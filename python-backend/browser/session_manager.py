"""SessionManager — browser lifecycle, context pool, tabs, health, cleanup."""

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional

try:
    from browser_use import Browser, BrowserConfig
except ImportError:  # browser-use not installed; provide lightweight stubs for tests
    Browser = None  # type: ignore[assignment,misc]

    class BrowserConfig:  # type: ignore[no-redef]
        """Minimal stub so SessionManager can be tested without browser-use installed."""
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

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
