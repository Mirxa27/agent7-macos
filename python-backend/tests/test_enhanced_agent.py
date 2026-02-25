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
        from browser.enhanced_agent import PageState
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
