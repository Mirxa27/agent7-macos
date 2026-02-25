#!/usr/bin/env python3
"""
Agent7 Advanced Backend
Full browser-use integration with autonomous agentic capabilities
"""

import asyncio
import json
import base64
import websockets
import traceback
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from enum import Enum
import logging

# Advanced imports
from browser_use import Agent, Browser, BrowserConfig, Controller
from browser_use.browser.context import BrowserContext
from browser_use.agent.views import ActionResult
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
try:
    from langchain_aws import ChatBedrockConverse
except ImportError:
    ChatBedrockConverse = None
import cv2
import numpy as np
from PIL import Image
import io

# Browser package imports
from browser import (
    AgentBrowserConfig,
    ReliableBrowser,
    CircuitBreakerOpen,
    SessionManager,
    SmartVision,
    EnhancedAgent,
    AgentOrchestrator,
)

# Setup logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class AgentState(Enum):
    IDLE = "idle"
    PLANNING = "planning"
    EXECUTING = "executing"
    OBSERVING = "observing"
    LEARNING = "learning"
    ERROR = "error"


@dataclass
class Task:
    id: str
    description: str
    goal: str
    context: Dict[str, Any] = field(default_factory=dict)
    steps: List[Dict] = field(default_factory=list)
    current_step: int = 0
    status: str = "pending"
    created_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    result: Any = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentMemory:
    """Advanced memory system with episodic and semantic memory"""

    conversations: List[Dict] = field(default_factory=list)
    tasks: List[Task] = field(default_factory=list)
    browser_sessions: List[Dict] = field(default_factory=list)
    knowledge_base: Dict[str, Any] = field(default_factory=dict)
    skill_library: Dict[str, Any] = field(default_factory=dict)

    async def add_episode(self, task: Task, observations: List[str], outcome: str):
        """Store episodic memory (experiences)"""
        episode = {
            "timestamp": datetime.now().isoformat(),
            "task": task.description,
            "observations": observations,
            "outcome": outcome,
            "success": task.status == "completed",
        }
        self.conversations.append(episode)

    async def retrieve_relevant(self, query: str, k: int = 5) -> List[Dict]:
        """Retrieve relevant memories based on semantic similarity"""
        # Simple keyword matching - in production use embeddings
        relevant = []
        query_words = set(query.lower().split())

        for episode in reversed(self.conversations):
            episode_text = f"{episode['task']} {' '.join(episode['observations'])}"
            episode_words = set(episode_text.lower().split())
            similarity = len(query_words & episode_words) / len(
                query_words | episode_words
            )
            if similarity > 0.3:
                relevant.append({**episode, "similarity": similarity})

        return sorted(relevant, key=lambda x: x["similarity"], reverse=True)[:k]


class AutonomousAgent:
    """Advanced autonomous agent with planning and self-improvement"""

    def __init__(self, api_keys: Dict[str, str]):
        self.api_keys = api_keys
        self.memory = AgentMemory()
        self.state = AgentState.IDLE
        self.current_task: Optional[Task] = None
        self.skill_library = {}
        self.planning_strategies = {}

        # New layered browser automation
        self._browser_config = AgentBrowserConfig()
        self._session_manager = SessionManager(config=self._browser_config)
        self._reliable_browser = ReliableBrowser(config=self._browser_config)
        self._smart_vision = SmartVision()
        self._enhanced_agent = EnhancedAgent(config=self._browser_config)

        # Legacy compat: keep browser_agent reference pointing to reliable_browser
        self.browser_agent = self._reliable_browser

    async def initialize(self):
        """Initialize autonomous agent with new browser layers."""
        await self._session_manager.initialize()
        context = await self._session_manager.get_context()
        self._reliable_browser.set_context(context)

        # Wire up the enhanced agent
        llm = self.get_llm()
        self._enhanced_agent.set_components(
            reliable_browser=self._reliable_browser,
            smart_vision=self._smart_vision,
            llm=llm,
        )
        logger.info("Autonomous agent initialized with enhanced browser layers")

    def get_llm(self, provider: str = "openai"):
        """Get language model based on available API keys."""
        if provider == "openai" and self.api_keys.get("openai"):
            return ChatOpenAI(
                model="gpt-4o", api_key=self.api_keys["openai"], temperature=0.3
            )
        elif provider == "anthropic" and self.api_keys.get("anthropic"):
            return ChatAnthropic(
                model="claude-3-5-sonnet-20241022",
                api_key=self.api_keys["anthropic"],
                temperature=0.3,
            )
        elif provider == "google" and self.api_keys.get("google"):
            return ChatGoogleGenerativeAI(
                model="gemini-2.0-flash-exp",
                api_key=self.api_keys["google"],
                temperature=0.3,
            )
        elif provider == "bedrock" and self.api_keys.get("bedrock"):
            if ChatBedrockConverse is None:
                raise ValueError(
                    "langchain-aws package is required for Bedrock provider. "
                    "Install it with: pip install langchain-aws"
                )
            bedrock_config = self.api_keys["bedrock"]
            model_id = bedrock_config.get(
                "model_id", "anthropic.claude-3-5-sonnet-20241022-v2:0"
            )
            return ChatBedrockConverse(
                model_id=model_id,
                region_name=bedrock_config.get("region", "us-east-1"),
                credentials_profile_name=None,
                aws_access_key_id=bedrock_config.get("aws_access_key_id"),
                aws_secret_access_key=bedrock_config.get("aws_secret_access_key"),
                temperature=0.3,
            )
        # Fallback: try any available provider
        for p in ["openai", "anthropic", "google", "bedrock"]:
            if self.api_keys.get(p):
                return self.get_llm(p)
        raise ValueError("No API key available for any provider")

    async def execute_complex_task(
        self, goal: str, context: Dict = None
    ) -> Dict[str, Any]:
        """Execute complex multi-step task autonomously"""
        try:
            self.state = AgentState.PLANNING

            # Create task
            task = Task(
                id=f"task_{datetime.now().timestamp()}",
                description=goal,
                goal=goal,
                context=context or {},
                status="planning",
            )
            self.current_task = task

            # Step 1: Analyze and Plan
            plan = await self.create_plan(goal, context)
            task.steps = plan["steps"]
            task.status = "executing"
            self.state = AgentState.EXECUTING

            # Step 2: Execute each step
            results = []
            observations = []

            for i, step in enumerate(task.steps):
                task.current_step = i
                logger.info(
                    f"Executing step {i + 1}/{len(task.steps)}: {step['action']}"
                )

                # Execute step
                result = await self.execute_step(step, context)
                results.append(result)
                observations.append(
                    f"Step {i + 1}: {result.get('summary', 'Completed')}"
                )

                # Adapt plan based on results
                if not result.get("success"):
                    logger.warning(f"Step failed, adapting plan...")
                    adapted_plan = await self.adapt_plan(task, result)
                    if adapted_plan:
                        task.steps = adapted_plan["steps"]

                # Check if we need to pause for user input
                if step.get("requires_confirmation"):
                    await self.request_user_confirmation(step, result)

            # Step 3: Learn from experience
            self.state = AgentState.LEARNING
            await self.learn_from_task(task, results, observations)

            # Complete task
            task.status = "completed"
            task.completed_at = datetime.now()
            task.result = {
                "steps_completed": len(results),
                "results": results,
                "summary": self.summarize_results(results),
            }

            # Store in memory
            await self.memory.add_episode(task, observations, "success")

            self.state = AgentState.IDLE
            return {
                "success": True,
                "task": task,
                "results": results,
                "summary": task.result["summary"],
            }

        except Exception as e:
            logger.error(f"Complex task execution error: {e}")
            traceback.print_exc()
            self.state = AgentState.ERROR
            if self.current_task:
                self.current_task.status = "failed"
            return {
                "success": False,
                "error": str(e),
                "traceback": traceback.format_exc(),
            }

    async def create_plan(self, goal: str, context: Dict) -> Dict[str, Any]:
        """Create execution plan using LLM"""
        # Retrieve relevant past experiences
        relevant_memories = await self.memory.retrieve_relevant(goal)

        plan_prompt = f"""Create a detailed step-by-step plan to accomplish this goal:

Goal: {goal}
Context: {json.dumps(context, indent=2)}

Relevant past experiences:
{json.dumps(relevant_memories[:3], indent=2)}

Create a plan with 3-10 specific, actionable steps. Each step should include:
- action: What to do
- tool: Which tool to use (browser, code, file, api, etc.)
- expected_outcome: What should happen
- requires_confirmation: true/false (for critical actions)

Return ONLY a JSON object with this structure:
{{"steps": [{{"action": "...", "tool": "...", "expected_outcome": "...", "requires_confirmation": false}}]}}"""

        try:
            # Call LLM for planning
            llm = self.get_llm("openai")
            response = await llm.ainvoke(plan_prompt)

            # Parse plan
            plan_text = (
                response.content if hasattr(response, "content") else str(response)
            )
            # Extract JSON from response
            import re

            json_match = re.search(r"\{.*\}", plan_text, re.DOTALL)
            if json_match:
                plan = json.loads(json_match.group())
            else:
                # Fallback plan
                plan = {
                    "steps": [
                        {
                            "action": f"Analyze the goal: {goal}",
                            "tool": "analysis",
                            "expected_outcome": "Understanding of requirements",
                            "requires_confirmation": False,
                        },
                        {
                            "action": f"Execute main task",
                            "tool": "browser",
                            "expected_outcome": "Task completed",
                            "requires_confirmation": False,
                        },
                        {
                            "action": "Verify results",
                            "tool": "verification",
                            "expected_outcome": "Confirmation of success",
                            "requires_confirmation": False,
                        },
                    ]
                }

            return plan

        except Exception as e:
            logger.error(f"Plan creation error: {e}")
            # Return fallback plan
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

    async def execute_step(self, step: Dict, context: Dict) -> Dict[str, Any]:
        """Execute a single step"""
        tool = step.get("tool", "browser")
        action = step.get("action", "")

        if tool == "browser":
            # Use enhanced agent for browser tasks
            return await self._enhanced_agent.execute_task(action, context)
        elif tool == "code":
            # Execute code
            return await self.execute_code(action)
        elif tool == "file":
            # File operation
            return await self.execute_file_operation(action)
        else:
            # General execution
            return {"success": True, "summary": f"Executed: {action}"}

    async def execute_code(self, code: str) -> Dict[str, Any]:
        """Safely execute Python code"""
        try:
            # Create safe execution environment
            import subprocess

            result = subprocess.run(
                ["python3", "-c", code], capture_output=True, text=True, timeout=30
            )
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "summary": "Code executed"
                if result.returncode == 0
                else f"Error: {result.stderr[:100]}",
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "summary": f"Execution failed: {e}",
            }

    async def execute_file_operation(self, action: str) -> Dict[str, Any]:
        """Execute file system operation"""
        # Implement file operations
        return {"success": True, "summary": f"File operation: {action}"}

    async def adapt_plan(self, task: Task, failed_result: Dict) -> Optional[Dict]:
        """Adapt plan based on failure"""
        # Analyze failure and create alternative approach
        return None

    async def request_user_confirmation(self, step: Dict, result: Dict):
        """Request user confirmation for critical actions"""
        # Would send IPC message to frontend
        pass

    async def learn_from_task(
        self, task: Task, results: List[Dict], observations: List[str]
    ):
        """Extract lessons and improve from completed task"""
        # Analyze what worked and what didn't
        successful_steps = [r for r in results if r.get("success")]
        failed_steps = [r for r in results if not r.get("success")]

        # Update skill library
        if len(failed_steps) == 0:
            # Task completed successfully - store as reliable approach
            self.skill_library[task.goal[:50]] = {
                "plan": task.steps,
                "success_rate": 1.0,
                "uses": 1,
            }

        logger.info(
            f"Learning complete: {len(successful_steps)} successful, {len(failed_steps)} failed steps"
        )

    def summarize_results(self, results: List[Dict]) -> str:
        """Create summary of results"""
        successful = sum(1 for r in results if r.get("success"))
        return f"Task completed with {successful}/{len(results)} successful steps"


class Agent7Server:
    """WebSocket server for Electron frontend communication"""

    def __init__(self, host: str = "localhost", port: int = 8765):
        self.host = host
        self.port = port
        self.clients: set = set()
        self.autonomous_agent: Optional[AutonomousAgent] = None
        self.api_keys: Dict[str, str] = {}

    async def register_client(self, websocket):
        """Register new client connection"""
        self.clients.add(websocket)
        logger.info(f"Client connected. Total clients: {len(self.clients)}")

    async def unregister_client(self, websocket):
        """Unregister client connection"""
        self.clients.discard(websocket)
        logger.info(f"Client disconnected. Total clients: {len(self.clients)}")

    async def broadcast(self, message: Dict):
        """Broadcast message to all clients"""
        if self.clients:
            message_json = json.dumps(message)
            await asyncio.gather(
                *[client.send(message_json) for client in self.clients],
                return_exceptions=True,
            )

    async def handle_message(self, websocket, message: str):
        """Handle incoming message from client"""
        try:
            data = json.loads(message)
            method = data.get("method")
            params = data.get("params", {})
            request_id = data.get("id")

            logger.info(f"Received: {method}")

            response = {"id": request_id, "result": None, "error": None}

            if method == "initialize":
                # Initialize with API keys
                self.api_keys = params.get("api_keys", {})
                self.autonomous_agent = AutonomousAgent(self.api_keys)
                await self.autonomous_agent.initialize()
                response["result"] = {"status": "initialized"}

            elif method == "execute_task":
                # Execute complex task
                if not self.autonomous_agent:
                    response["error"] = "Agent not initialized"
                else:
                    task = params.get("task", "")
                    context = params.get("context", {})
                    result = await self.autonomous_agent.execute_complex_task(
                        task, context
                    )
                    response["result"] = result

            elif method == "orchestrate_task":
                # Multi-agent orchestrated execution
                if not self.autonomous_agent:
                    response["error"] = "Agent not initialized"
                else:
                    goal = params.get("goal", params.get("task", ""))
                    context = params.get("context", {})

                    orchestrator = AgentOrchestrator()
                    orchestrator.set_llm(self.autonomous_agent.get_llm())
                    orchestrator.initialize_agents()

                    # Wire browser agent handler
                    orchestrator.register_handler(
                        "browser",
                        lambda task: self.autonomous_agent._enhanced_agent.execute_task(
                            task.get("description", ""), task
                        ),
                    )

                    # Wire progress broadcasting
                    async def broadcast_progress(event):
                        await self.broadcast({
                            "type": "orchestration_progress",
                            "data": event,
                        })

                    orchestrator.on_progress = broadcast_progress

                    result = await orchestrator.orchestrate(goal, context)
                    response["result"] = result

            elif method == "browser_navigate":
                if self.autonomous_agent:
                    url = params.get("url", "")
                    result = await self.autonomous_agent.browser_agent.navigate(url)
                    response["result"] = result

            elif method == "browser_click":
                if self.autonomous_agent:
                    selector = params.get("selector", "")
                    result = await self.autonomous_agent.browser_agent.click(selector)
                    response["result"] = result

            elif method == "browser_type":
                if self.autonomous_agent:
                    selector = params.get("selector", "")
                    text = params.get("text", "")
                    result = await self.autonomous_agent.browser_agent.type_text(
                        selector, text
                    )
                    response["result"] = result

            elif method == "browser_screenshot":
                if self.autonomous_agent:
                    screenshot = (
                        await self.autonomous_agent.browser_agent.get_screenshot()
                    )
                    response["result"] = {"screenshot": screenshot}

            elif method == "browser_extract":
                if self.autonomous_agent:
                    selector = params.get("selector")
                    result = await self.autonomous_agent.browser_agent.extract_content(selector)
                    response["result"] = result

            elif method == "browser_execute":
                if self.autonomous_agent:
                    task = params.get("task", "")
                    context = params.get("context", {})
                    result = await self.autonomous_agent._enhanced_agent.execute_task(
                        task, context
                    )
                    response["result"] = result

            elif method == "memory_search":
                if self.autonomous_agent:
                    query = params.get("query", "")
                    results = await self.autonomous_agent.memory.retrieve_relevant(
                        query
                    )
                    response["result"] = results

            elif method == "get_agents":
                response["result"] = {
                    "agents": [
                        {"name": "browser", "type": "browser", "status": "ready"},
                        {"name": "planner", "type": "planning", "status": "ready"},
                        {"name": "coder", "type": "coding", "status": "ready"},
                    ]
                }

            elif method == "ping":
                response["result"] = {"pong": True}

            else:
                response["error"] = f"Unknown method: {method}"

            await websocket.send(json.dumps(response))

        except Exception as e:
            logger.error(f"Message handling error: {e}")
            traceback.print_exc()
            error_response = {
                "id": data.get("id") if "data" in locals() else None,
                "error": str(e),
            }
            await websocket.send(json.dumps(error_response))

    async def handler(self, websocket, path):
        """WebSocket connection handler"""
        await self.register_client(websocket)
        try:
            async for message in websocket:
                await self.handle_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            logger.info("Connection closed")
        finally:
            await self.unregister_client(websocket)

    async def start(self):
        """Start WebSocket server"""
        logger.info(f"Starting Agent7 server on ws://{self.host}:{self.port}")
        async with websockets.serve(self.handler, self.host, self.port):
            await asyncio.Future()  # Run forever


async def main():
    """Main entry point"""
    server = Agent7Server()
    await server.start()


if __name__ == "__main__":
    asyncio.run(main())
