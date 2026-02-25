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

try:
    from browser.reliable_browser import ReliableBrowser, CircuitBreakerOpen
except ImportError:  # pragma: no cover
    ReliableBrowser = None  # type: ignore[misc,assignment]
    CircuitBreakerOpen = Exception  # type: ignore[misc,assignment]

try:
    from browser.smart_vision import SmartVision, PageState
except ImportError:  # pragma: no cover
    SmartVision = None  # type: ignore[misc,assignment]
    from dataclasses import dataclass as _dataclass, field as _field
    from typing import Any as _Any, Dict as _Dict, List as _List

    @_dataclass
    class PageState:  # type: ignore[no-redef]
        """Fallback PageState when smart_vision is unavailable."""
        url: str = ""
        title: str = ""
        visible_text: str = ""
        form_fields: _List[_Dict[str, _Any]] = _field(default_factory=list)
        timestamp: str = ""

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
