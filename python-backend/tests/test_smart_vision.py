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
