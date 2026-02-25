import pytest
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch
from browser.orchestrator import AgentOrchestrator, SpecializedAgent, TaskDecomposition


class TestSpecializedAgent:
    def test_create_agent(self):
        agent = SpecializedAgent(name="browser", agent_type="browser", priority=2)
        assert agent.name == "browser"
        assert agent.status == "idle"

    @pytest.mark.asyncio
    async def test_execute_updates_status(self):
        agent = SpecializedAgent(name="researcher", agent_type="research", priority=2)
        handler = AsyncMock(return_value={"success": True, "output": "analysis done"})
        agent.set_handler(handler)
        result = await agent.execute({"description": "analyze data", "type": "research"})
        assert result["success"] is True
        assert agent.status == "idle"
        assert len(agent.history) == 1

    @pytest.mark.asyncio
    async def test_execute_sets_error_on_failure(self):
        agent = SpecializedAgent(name="coder", agent_type="coding", priority=2)
        handler = AsyncMock(side_effect=Exception("code error"))
        agent.set_handler(handler)
        result = await agent.execute({"description": "write code", "type": "coding"})
        assert result["success"] is False
        assert agent.status == "error"


class TestTaskDecomposition:
    def test_decompose_result(self):
        decomp = TaskDecomposition(
            goal="book a flight",
            sub_tasks=[
                {"id": 1, "description": "search flights", "type": "browser", "depends_on": []},
                {"id": 2, "description": "select flight", "type": "browser", "depends_on": [1]},
                {"id": 3, "description": "fill payment", "type": "browser", "depends_on": [2]},
            ],
        )
        assert len(decomp.sub_tasks) == 3
        assert decomp.sub_tasks[1]["depends_on"] == [1]


class TestOrchestratorRouting:
    @pytest.fixture
    def orchestrator(self):
        orch = AgentOrchestrator()
        orch._llm = AsyncMock()
        return orch

    def test_agent_type_mapping(self, orchestrator):
        assert orchestrator.select_agent("browser") == "browser"
        assert orchestrator.select_agent("research") == "researcher"
        assert orchestrator.select_agent("coding") == "coder"
        assert orchestrator.select_agent("file") == "file_manager"
        assert orchestrator.select_agent("review") == "reviewer"
        assert orchestrator.select_agent("planning") == "planner"
        assert orchestrator.select_agent("execution") == "executor"
        assert orchestrator.select_agent("unknown_type") == "executor"  # fallback

    def test_agents_are_registered(self, orchestrator):
        orchestrator.initialize_agents()
        assert len(orchestrator._agents) == 7
        assert "browser" in orchestrator._agents
        assert "planner" in orchestrator._agents
        assert "reviewer" in orchestrator._agents


class TestOrchestratorDecomposition:
    @pytest.fixture
    def orchestrator(self):
        orch = AgentOrchestrator()
        orch._llm = AsyncMock()
        return orch

    @pytest.mark.asyncio
    async def test_decompose_goal(self, orchestrator):
        plan_json = json.dumps({
            "sub_tasks": [
                {"id": 1, "description": "navigate to site", "type": "browser", "depends_on": []},
                {"id": 2, "description": "fill form", "type": "browser", "depends_on": [1]},
            ]
        })
        mock_response = MagicMock()
        mock_response.content = plan_json
        orchestrator._llm.ainvoke = AsyncMock(return_value=mock_response)
        decomp = await orchestrator.decompose("Fill out the registration form")
        assert len(decomp.sub_tasks) == 2

    @pytest.mark.asyncio
    async def test_decompose_fallback_on_error(self, orchestrator):
        orchestrator._llm.ainvoke = AsyncMock(side_effect=Exception("LLM down"))
        decomp = await orchestrator.decompose("Do something")
        assert len(decomp.sub_tasks) >= 1  # Fallback plan


class TestOrchestratorExecution:
    @pytest.fixture
    def orchestrator(self):
        orch = AgentOrchestrator()
        orch._llm = AsyncMock()
        orch.initialize_agents()
        # Set all agents to succeed
        for agent in orch._agents.values():
            agent.set_handler(AsyncMock(return_value={"success": True, "output": "done"}))
        return orch

    @pytest.mark.asyncio
    async def test_execute_plan_respects_dependencies(self, orchestrator):
        decomp = TaskDecomposition(
            goal="test",
            sub_tasks=[
                {"id": 1, "description": "step 1", "type": "browser", "depends_on": []},
                {"id": 2, "description": "step 2", "type": "coding", "depends_on": [1]},
                {"id": 3, "description": "step 3", "type": "review", "depends_on": [2]},
            ],
        )
        result = await orchestrator.execute_plan(decomp)
        assert result["success"] is True
        assert len(result["results"]) == 3

    @pytest.mark.asyncio
    async def test_execute_plan_reports_failure(self, orchestrator):
        # Make browser agent fail
        orchestrator._agents["browser"].set_handler(
            AsyncMock(side_effect=Exception("browser crashed"))
        )
        decomp = TaskDecomposition(
            goal="test",
            sub_tasks=[
                {"id": 1, "description": "browse", "type": "browser", "depends_on": []},
            ],
        )
        result = await orchestrator.execute_plan(decomp)
        assert result["success"] is False

    @pytest.mark.asyncio
    async def test_progress_callback(self, orchestrator):
        progress_events = []

        async def on_progress(event):
            progress_events.append(event)

        orchestrator.on_progress = on_progress
        decomp = TaskDecomposition(
            goal="test",
            sub_tasks=[
                {"id": 1, "description": "step 1", "type": "execution", "depends_on": []},
            ],
        )
        await orchestrator.execute_plan(decomp)
        assert len(progress_events) >= 1
        assert progress_events[0]["step"] == 1
