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
                f'or {{"found": false}} if not found. Return ONLY the JSON.'
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
