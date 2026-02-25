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
