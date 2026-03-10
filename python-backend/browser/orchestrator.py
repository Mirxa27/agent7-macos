"""AgentOrchestrator — multi-agent task decomposition and coordinated execution."""

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Coroutine, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class TaskDecomposition:
    """Result of decomposing a goal into sub-tasks."""

    goal: str
    sub_tasks: List[Dict[str, Any]] = field(default_factory=list)


class SpecializedAgent:
    """A named agent that handles a specific type of task."""

    def __init__(self, name: str, agent_type: str, priority: int = 3):
        self.name = name
        self.agent_type = agent_type
        self.priority = priority
        self.status = "idle"
        self.history: List[Dict] = []
        self._handler: Optional[Callable] = None

    def set_handler(self, handler: Callable):
        """Set the async function that executes tasks for this agent."""
        self._handler = handler

    async def execute(self, task: Dict) -> Dict[str, Any]:
        """Execute a task and return the result."""
        self.status = "busy"
        try:
            if self._handler:
                result = await self._handler(task)
            else:
                result = {"success": True, "output": f"Agent {self.name}: {task.get('description', '')}"}

            self.history.append({
                "task": task,
                "result": result,
                "timestamp": datetime.now().isoformat(),
            })
            self.status = "idle"
            return {
                "success": result.get("success", True),
                "agent": self.name,
                "output": result.get("output", ""),
                "summary": f"Agent {self.name} completed: {task.get('description', '')}",
            }
        except Exception as e:
            self.status = "error"
            return {
                "success": False,
                "agent": self.name,
                "error": str(e),
                "summary": f"Agent {self.name} failed: {e}",
            }


# Agent type → agent name mapping
AGENT_TYPE_MAP = {
    "browser": "browser",
    "research": "researcher",
    "analysis": "researcher",
    "coding": "coder",
    "code": "coder",
    "file": "file_manager",
    "review": "reviewer",
    "verification": "reviewer",
    "planning": "planner",
    "execution": "executor",
}


class AgentOrchestrator:
    """Coordinates 7 specialized agents to execute complex multi-step goals."""

    def __init__(self):
        self._agents: Dict[str, SpecializedAgent] = {}
        self._llm = None
        self.on_progress: Optional[Callable[..., Coroutine]] = None

    def set_llm(self, llm):
        self._llm = llm

    def initialize_agents(self):
        """Create the 7 specialized agents."""
        agent_configs = [
            ("planner", "planning", 1),
            ("researcher", "research", 2),
            ("executor", "execution", 3),
            ("coder", "coding", 2),
            ("browser", "browser", 2),
            ("file_manager", "file", 3),
            ("reviewer", "review", 4),
        ]
        for name, agent_type, priority in agent_configs:
            self._agents[name] = SpecializedAgent(name, agent_type, priority)

    def select_agent(self, task_type: str) -> str:
        """Select the appropriate agent name for a task type."""
        return AGENT_TYPE_MAP.get(task_type, "executor")

    def register_handler(self, agent_name: str, handler: Callable):
        """Register an execution handler for an agent."""
        if agent_name in self._agents:
            self._agents[agent_name].set_handler(handler)

    async def decompose(self, goal: str, context: Dict = None) -> TaskDecomposition:
        """Use LLM to decompose a goal into typed sub-tasks with dependencies."""
        context = context or {}

        prompt = f"""Decompose this goal into specific, actionable sub-tasks:

Goal: {goal}
Context: {json.dumps(context, indent=2)}

Create 3-7 sub-tasks. Each must include:
- id: sequential integer starting at 1
- description: what to do
- type: one of [browser, research, coding, file, review, planning, execution]
- depends_on: list of sub-task ids that must complete first (empty list if none)

Return ONLY JSON: {{"sub_tasks": [...]}}"""

        try:
            response = await self._llm.ainvoke(prompt)
            content = response.content if hasattr(response, "content") else str(response)
            json_match = re.search(r"\{.*\}", content, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
                return TaskDecomposition(
                    goal=goal,
                    sub_tasks=data.get("sub_tasks", []),
                )
        except Exception as e:
            logger.error(f"Decomposition error: {e}")

        # Fallback
        return TaskDecomposition(
            goal=goal,
            sub_tasks=[
                {"id": 1, "description": f"Analyze: {goal}", "type": "research", "depends_on": []},
                {"id": 2, "description": f"Execute: {goal}", "type": "execution", "depends_on": [1]},
                {"id": 3, "description": f"Verify: {goal}", "type": "review", "depends_on": [2]},
            ],
        )

    async def execute_plan(self, decomposition: TaskDecomposition) -> Dict[str, Any]:
        """Execute sub-tasks in dependency order using assigned agents."""
        completed: Dict[int, Dict] = {}
        results = []

        for sub_task in decomposition.sub_tasks:
            task_id = sub_task["id"]
            depends_on = sub_task.get("depends_on", [])

            # Check dependencies
            if not all(dep in completed for dep in depends_on):
                results.append({
                    "success": False,
                    "task_id": task_id,
                    "error": f"Dependencies not met: {depends_on}",
                })
                continue

            # Select and execute
            agent_name = self.select_agent(sub_task.get("type", "execution"))
            agent = self._agents.get(agent_name)

            if not agent:
                results.append({
                    "success": False,
                    "task_id": task_id,
                    "error": f"Agent not found: {agent_name}",
                })
                continue

            # Broadcast progress
            if self.on_progress:
                await self.on_progress({
                    "step": task_id,
                    "total": len(decomposition.sub_tasks),
                    "agent": agent_name,
                    "description": sub_task.get("description", ""),
                    "status": "executing",
                })

            result = await agent.execute(sub_task)
            results.append({**result, "task_id": task_id})

            if result.get("success"):
                completed[task_id] = result
            else:
                # Broadcast failure
                if self.on_progress:
                    await self.on_progress({
                        "step": task_id,
                        "agent": agent_name,
                        "status": "failed",
                        "error": result.get("error", ""),
                    })
                break  # Stop on failure (dependencies would block anyway)

        all_success = all(r.get("success") for r in results)
        return {
            "success": all_success,
            "goal": decomposition.goal,
            "results": results,
            "completed": len(completed),
            "total": len(decomposition.sub_tasks),
            "summary": f"{'Completed' if all_success else 'Failed'}: "
                       f"{len(completed)}/{len(decomposition.sub_tasks)} steps",
        }

    async def orchestrate(self, goal: str, context: Dict = None) -> Dict[str, Any]:
        """Full orchestration: decompose → assign → execute → report."""
        decomposition = await self.decompose(goal, context)
        return await self.execute_plan(decomposition)
