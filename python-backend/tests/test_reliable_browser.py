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
