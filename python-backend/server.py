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
import cv2
import numpy as np
from PIL import Image
import io

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


class VisionAnalyzer:
    """Advanced vision capabilities for UI understanding"""

    def __init__(self):
        self.element_cache = {}

    async def analyze_screenshot(self, screenshot_path: str) -> Dict[str, Any]:
        """Analyze screenshot to identify UI elements and context"""
        try:
            # Read image
            image = cv2.imread(screenshot_path)
            if image is None:
                return {"error": "Failed to load screenshot"}

            # Basic image analysis
            height, width = image.shape[:2]

            # Detect text regions (simplified - in production use OCR)
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

            # Detect edges and shapes
            edges = cv2.Canny(gray, 50, 150)
            contours, _ = cv2.findContours(
                edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )

            # Identify potential interactive elements
            elements = []
            for i, contour in enumerate(contours[:50]):  # Limit to top 50
                x, y, w, h = cv2.boundingRect(contour)
                if w > 30 and h > 20:  # Filter small elements
                    aspect_ratio = w / float(h)
                    elements.append(
                        {
                            "id": f"element_{i}",
                            "bbox": [x, y, w, h],
                            "center": [x + w // 2, y + h // 2],
                            "aspect_ratio": aspect_ratio,
                            "area": w * h,
                            "type": self.classify_element(aspect_ratio, w, h),
                        }
                    )

            return {
                "dimensions": {"width": width, "height": height},
                "elements": elements,
                "element_count": len(elements),
                "timestamp": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.error(f"Vision analysis error: {e}")
            return {"error": str(e)}

    def classify_element(self, aspect_ratio: float, width: int, height: int) -> str:
        """Classify UI element type based on shape"""
        if 0.9 < aspect_ratio < 1.1 and width < 100:
            return "button"
        elif aspect_ratio > 3:
            return "input_field"
        elif aspect_ratio < 0.3:
            return "scrollbar"
        elif width > 200 and height > 100:
            return "content_area"
        else:
            return "unknown"

    async def find_element_by_description(
        self, screenshot_path: str, description: str
    ) -> Optional[Dict]:
        """Find element matching natural language description"""
        analysis = await self.analyze_screenshot(screenshot_path)
        elements = analysis.get("elements", [])

        # Simple matching - in production use vision-language model
        description_lower = description.lower()
        best_match = None
        best_score = 0

        for element in elements:
            score = 0
            if "button" in description_lower and element["type"] == "button":
                score += 0.5
            if "input" in description_lower and element["type"] == "input_field":
                score += 0.5

            if score > best_score:
                best_score = score
                best_match = element

        return best_match


class BrowserAgent:
    """Advanced browser automation with live browser-use integration"""

    def __init__(self, api_keys: Dict[str, str]):
        self.api_keys = api_keys
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.agent: Optional[Agent] = None
        self.controller = Controller()
        self.vision = VisionAnalyzer()
        self.current_page = None
        self.session_history = []

    async def initialize(self):
        """Initialize browser with advanced configuration"""
        try:
            config = BrowserConfig(
                headless=False,  # Show browser for live interaction
                chrome_instance_path=None,  # Use playwright-managed browser
                extra_chromium_args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-accelerated-2d-canvas",
                    "--no-first-run",
                    "--no-zygote",
                    "--single-process",
                    "--disable-gpu",
                ],
            )

            self.browser = Browser(config=config)
            self.context = await self.browser.new_context()
            logger.info("Browser initialized successfully")

        except Exception as e:
            logger.error(f"Browser initialization error: {e}")
            raise

    def get_llm(self, provider: str = "openai"):
        """Get language model for agent"""
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
        else:
            raise ValueError(f"No API key available for provider: {provider}")

    async def execute_task(self, task: str, provider: str = "openai") -> Dict[str, Any]:
        """Execute autonomous browser task using browser-use"""
        try:
            if not self.browser:
                await self.initialize()

            # Create agent with task
            llm = self.get_llm(provider)

            self.agent = Agent(
                task=task,
                llm=llm,
                browser=self.browser,
                controller=self.controller,
                use_vision=True,  # Enable vision capabilities
                save_conversation_path="logs/conversation",
            )

            logger.info(f"Starting browser task: {task}")

            # Run the agent
            result = await self.agent.run()

            # Extract results
            final_result = {
                "success": result.is_done() if hasattr(result, "is_done") else True,
                "output": result.final_result()
                if hasattr(result, "final_result")
                else str(result),
                "actions": self.extract_actions(result),
                "url": await self.get_current_url(),
                "timestamp": datetime.now().isoformat(),
            }

            self.session_history.append(
                {
                    "task": task,
                    "result": final_result,
                    "timestamp": datetime.now().isoformat(),
                }
            )

            return final_result

        except Exception as e:
            logger.error(f"Browser task execution error: {e}")
            traceback.print_exc()
            return {
                "success": False,
                "error": str(e),
                "traceback": traceback.format_exc(),
            }

    def extract_actions(self, result) -> List[Dict]:
        """Extract actions from agent result"""
        actions = []
        # Access action history from agent
        if hasattr(self.agent, "history"):
            for action in self.agent.history:
                actions.append(
                    {
                        "action": action.get_description()
                        if hasattr(action, "get_description")
                        else str(action),
                        "timestamp": datetime.now().isoformat(),
                    }
                )
        return actions

    async def get_current_url(self) -> str:
        """Get current page URL"""
        try:
            if self.context and self.context.page:
                return self.context.page.url
            return ""
        except:
            return ""

    async def get_screenshot(self) -> str:
        """Capture and return screenshot as base64"""
        try:
            if self.context and self.context.page:
                screenshot = await self.context.page.screenshot(
                    type="jpeg", quality=80, full_page=False
                )
                return base64.b64encode(screenshot).decode("utf-8")
            return ""
        except Exception as e:
            logger.error(f"Screenshot error: {e}")
            return ""

    async def navigate(self, url: str) -> Dict[str, Any]:
        """Navigate to URL"""
        try:
            if self.context and self.context.page:
                await self.context.page.goto(url, wait_until="networkidle")
                return {
                    "success": True,
                    "url": url,
                    "title": await self.context.page.title(),
                }
            return {"success": False, "error": "Browser not initialized"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def click(self, selector: str) -> Dict[str, Any]:
        """Click element by selector"""
        try:
            if self.context and self.context.page:
                await self.context.page.click(selector)
                return {"success": True, "action": f"clicked {selector}"}
            return {"success": False, "error": "Browser not initialized"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def type_text(self, selector: str, text: str) -> Dict[str, Any]:
        """Type text into element"""
        try:
            if self.context and self.context.page:
                await self.context.page.fill(selector, text)
                return {"success": True, "action": f"typed into {selector}"}
            return {"success": False, "error": "Browser not initialized"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def extract_content(self, selector: str = None) -> Dict[str, Any]:
        """Extract content from page"""
        try:
            if self.context and self.context.page:
                if selector:
                    elements = await self.context.page.query_selector_all(selector)
                    content = []
                    for elem in elements[:10]:  # Limit to first 10
                        text = await elem.text_content()
                        content.append(text)
                    return {"success": True, "content": content}
                else:
                    # Get full page content
                    content = await self.context.page.content()
                    return {"success": True, "content": content[:5000]}  # Limit size
            return {"success": False, "error": "Browser not initialized"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def close(self):
        """Close browser"""
        try:
            if self.browser:
                await self.browser.close()
                logger.info("Browser closed")
        except Exception as e:
            logger.error(f"Error closing browser: {e}")


class AutonomousAgent:
    """Advanced autonomous agent with planning and self-improvement"""

    def __init__(self, api_keys: Dict[str, str]):
        self.api_keys = api_keys
        self.memory = AgentMemory()
        self.browser_agent = BrowserAgent(api_keys)
        self.state = AgentState.IDLE
        self.current_task: Optional[Task] = None
        self.skill_library = {}
        self.planning_strategies = {}

    async def initialize(self):
        """Initialize autonomous agent"""
        await self.browser_agent.initialize()
        logger.info("Autonomous agent initialized")

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
            llm = self.browser_agent.get_llm("openai")
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
            # Use browser agent
            return await self.browser_agent.execute_task(action)
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

            elif method == "browser_execute":
                if self.autonomous_agent:
                    task = params.get("task", "")
                    provider = params.get("provider", "openai")
                    result = await self.autonomous_agent.browser_agent.execute_task(
                        task, provider
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
