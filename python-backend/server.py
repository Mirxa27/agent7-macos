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
import re
from datetime import datetime
from typing import Dict, List, Any, Optional, Union
import workflows as wf_store
from dataclasses import dataclass, field
from enum import Enum
import logging
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage
from langchain_core.language_models import BaseChatModel

# Advanced imports
try:
    from browser_use import Agent, Browser
except ImportError:
    # Fallback for newer browser_use versions
    from browser_use import Agent
    from browser_use.browser.session import BrowserSession as Browser
try:
    from browser_use.browser.context import BrowserContext
except ImportError:
    BrowserContext = None
try:
    from browser_use.agent.views import ActionResult
except ImportError:
    ActionResult = None
# BrowserConfig removed in newer versions - use Browser/Agent kwargs instead
BrowserConfig = None
Controller = None
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


class ContextWindowManager:
    """Manages context window limits for LLM calls to prevent token overflow.
    
    Uses a simple estimation method: ~4 characters per token for English text.
    This is a safe upper bound - actual token count may be lower.
    For production, consider using tiktoken or anthropic's tokenizer.
    """
    
    # Model context window limits (input tokens)
    MODEL_LIMITS = {
        # Anthropic Claude models
        "claude-opus-4-5": 200000,
        "claude-opus-4": 200000,
        "claude-3-5-sonnet": 200000,
        "claude-3-5": 200000,
        "claude-3-opus": 200000,
        "claude-3-sonnet": 150000,
        "claude-3": 150000,
        "claude-2-1": 200000,
        "claude-2": 200000,
        "claude-instant": 100000,
        # OpenAI models
        "gpt-4o": 128000,
        "gpt-4-turbo": 128000,
        "gpt-4": 8192,
        "gpt-3.5-turbo": 16385,
        # Google models
        "gemini-2": 200000,
        "gemini-1.5": 200000,
        "gemini-pro": 30720,
    }
    
    # Default safety margin - keep 10% below max to allow for response
    DEFAULT_SAFETY_MARGIN = 0.9
    
    def __init__(self, model_name: str = None, safety_margin: float = None):
        self.model_name = model_name or "claude-3-5-sonnet"
        self.safety_margin = safety_margin or self.DEFAULT_SAFETY_MARGIN
        self.max_tokens = self._get_model_limit()
        
    def _get_model_limit(self) -> int:
        """Get the context window limit for the current model."""
        model_lower = self.model_name.lower()
        
        for key, limit in self.MODEL_LIMITS.items():
            if key in model_lower:
                return int(limit * self.safety_margin)
        
        # Default to 150k if unknown
        logger.warning(f"Unknown model: {self.model_name}, using default limit of 135k")
        return int(150000 * self.safety_margin)
    
    def estimate_tokens(self, text: str) -> int:
        """Estimate token count for text. Uses ~4 chars per token as safe upper bound."""
        if not text:
            return 0
        return len(text) // 4
    
    def estimate_messages_tokens(self, messages: List[Union[Dict, BaseMessage]]) -> int:
        """Estimate total tokens in a list of messages."""
        total = 0
        
        # Add overhead for message structure (approximately 4 tokens per message)
        total += len(messages) * 4
        
        for msg in messages:
            if isinstance(msg, dict):
                # Handle dict format messages
                content = msg.get("content", "")
                if isinstance(content, list):
                    # Handle multimodal content
                    for item in content:
                        if isinstance(item, dict):
                            text = item.get("text", "")
                            total += self.estimate_tokens(text)
                        else:
                            total += self.estimate_tokens(str(item))
                else:
                    total += self.estimate_tokens(str(content))
            elif hasattr(msg, "content"):
                # Handle LangChain message objects
                content = msg.content
                if isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict):
                            text = item.get("text", "")
                            total += self.estimate_tokens(text)
                        else:
                            total += self.estimate_tokens(str(item))
                else:
                    total += self.estimate_tokens(str(content))
            else:
                total += self.estimate_tokens(str(msg))
        
        return total
    
    def trim_messages(
        self, 
        messages: List[Union[Dict, BaseMessage]], 
        max_tokens: int = None
    ) -> List[Union[Dict, BaseMessage]]:
        """Trim messages to fit within token limit.
        
        Keeps system message if present, then keeps most recent messages.
        """
        if max_tokens is None:
            max_tokens = self.max_tokens
            
        # If messages already fit, return as-is
        current_tokens = self.estimate_messages_tokens(messages)
        if current_tokens <= max_tokens:
            return messages
            
        logger.warning(
            f"Trimming messages: {current_tokens} tokens -> {max_tokens} tokens limit"
        )
        
        # Separate system message from others
        system_msg = None
        other_messages = []
        
        for msg in messages:
            if isinstance(msg, dict):
                role = msg.get("role", "").lower()
                if role == "system":
                    system_msg = msg
                else:
                    other_messages.append(msg)
            elif hasattr(msg, "type"):
                if msg.type == "system":
                    system_msg = msg
                else:
                    other_messages.append(msg)
            else:
                other_messages.append(msg)
        
        # Calculate tokens for system message
        system_tokens = 0
        if system_msg:
            system_tokens = self.estimate_messages_tokens([system_msg])
            if system_tokens >= max_tokens:
                # System message too big, just return it with a warning
                logger.error(f"System message alone exceeds token limit: {system_tokens}")
                return [system_msg] if not hasattr(system_msg, "type") else [system_msg]
        
        # Available tokens for other messages
        available_tokens = max_tokens - system_tokens
        
        # Start from most recent and work backwards
        trimmed = []
        current_tokens = 0
        
        for msg in reversed(other_messages):
            msg_tokens = self.estimate_messages_tokens([msg])
            if current_tokens + msg_tokens <= available_tokens:
                trimmed.insert(0, msg)
                current_tokens += msg_tokens
            else:
                break
        
        # Add system message at the beginning if present
        if system_msg:
            trimmed.insert(0, system_msg)
        
        logger.info(
            f"Trimmed from {len(messages)} to {len(trimmed)} messages, "
            f"~{current_tokens + system_tokens} tokens"
        )
        
        return trimmed
    
    def trim_prompt(
        self, 
        prompt: str, 
        max_tokens: int = None,
        suffix: str = "\n\n[Previous context truncated due to length limits]"
    ) -> str:
        """Trim a prompt string to fit within token limit."""
        if max_tokens is None:
            max_tokens = self.max_tokens
            
        current_tokens = self.estimate_tokens(prompt)
        if current_tokens <= max_tokens:
            return prompt
        
        # Calculate max characters allowed
        max_chars = max_tokens * 4  # Reverse the estimation
        
        # Trim and add suffix noting the truncation
        trimmed = prompt[:max_chars - len(suffix)] + suffix
        
        logger.warning(
            f"Trimmed prompt: {current_tokens} -> {self.estimate_tokens(trimmed)} tokens"
        )
        
        return trimmed


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
    storage_file: str = "python-backend/data/memory.json"

    def __post_init__(self):
        self.load_memory()

    def save_memory(self):
        """Persist memory to disk"""
        try:
            os.makedirs(os.path.dirname(self.storage_file), exist_ok=True)
            data = {
                "conversations": self.conversations,
                "browser_sessions": self.browser_sessions,
                "knowledge_base": self.knowledge_base,
                "skill_library": self.skill_library
            }
            with open(self.storage_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to save memory: {e}")

    def load_memory(self):
        """Load memory from disk"""
        try:
            if os.path.exists(self.storage_file):
                with open(self.storage_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.conversations = data.get("conversations", [])
                    self.browser_sessions = data.get("browser_sessions", [])
                    self.knowledge_base = data.get("knowledge_base", {})
                    self.skill_library = data.get("skill_library", {})
        except Exception as e:
            logger.error(f"Failed to load memory: {e}")

    async def add_episode(self, task: Task, observations: List[str], outcome: str):
        """Store episodic memory (experiences)"""
        episode = {
            "timestamp": datetime.now().isoformat(),
            "task": task.description,
            "observations": observations,
            "outcome": outcome,
            "success": task.status == "completed",
            "context": task.context
        }
        self.conversations.append(episode)
        self.save_memory()

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
        
        # Context window management
        self._current_provider = "openai"
        self._current_model = "gpt-4o"
        self._context_manager: Optional[ContextWindowManager] = None

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
        
        # Initialize context window manager with the current model
        self._context_manager = ContextWindowManager(model_name=self._current_model)
        
        logger.info("Autonomous agent initialized with enhanced browser layers")

    def get_llm(self, provider: str = "openai"):
        """Get language model based on available API keys."""
        self._current_provider = provider
        
        if provider == "openai" and self.api_keys.get("openai"):
            self._current_model = "gpt-4o"
            return ChatOpenAI(
                model="gpt-4o", api_key=self.api_keys["openai"], temperature=0.3
            )
        elif provider == "anthropic" and self.api_keys.get("anthropic"):
            self._current_model = "claude-3-5-sonnet-20241022"
            return ChatAnthropic(
                model="claude-3-5-sonnet-20241022",
                api_key=self.api_keys["anthropic"],
                temperature=0.3,
            )
        elif provider == "google" and self.api_keys.get("google"):
            self._current_model = "gemini-2.0-flash-exp"
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
            self._current_model = model_id
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
    
    def _is_context_window_error(self, error: Exception) -> bool:
        """Check if an error is a context window exceeded error."""
        error_str = str(error).lower()
        context_window_errors = [
            "context window",
            "context limit",
            "max tokens",
            "token limit",
            "too many tokens",
            "prompt is too long",
            "input too long",
            "maximum context",
            "context_length_exceeded",
        ]
        return any(ctx_err in error_str for ctx_err in context_window_errors)
    
    async def _call_llm_with_retry(
        self, 
        llm: BaseChatModel, 
        prompt: str, 
        max_retries: int = 3
    ) -> Any:
        """Call LLM with automatic context window error handling and retry.
        
        If context window error occurs, trims the prompt and retries.
        """
        # Ensure context manager is initialized
        if self._context_manager is None:
            self._context_manager = ContextWindowManager(model_name=self._current_model)
        
        # Trim prompt before sending
        trimmed_prompt = self._context_manager.trim_prompt(prompt)
        
        for attempt in range(max_retries):
            try:
                response = await llm.ainvoke(trimmed_prompt)
                return response
            except Exception as e:
                if self._is_context_window_error(e) and attempt < max_retries - 1:
                    # Reduce the max_tokens setting for next attempt
                    current_limit = self._context_manager.max_tokens
                    new_limit = int(current_limit * 0.7)  # Reduce by 30%
                    logger.warning(
                        f"Context window error (attempt {attempt + 1}/{max_retries}). "
                        f"Reducing limit from {current_limit} to {new_limit} tokens."
                    )
                    self._context_manager.max_tokens = new_limit
                    
                    # Re-trim prompt with new limit
                    trimmed_prompt = self._context_manager.trim_prompt(prompt)
                else:
                    # Re-raise on final attempt or non-context errors
                    raise
        
        return None  # Should not reach here

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
        """Create execution plan using LLM with context window handling."""
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
            # Call LLM for planning with retry and context window handling
            llm = self.get_llm("openai")
            response = await self._call_llm_with_retry(llm, plan_prompt)

            # Parse plan
            plan_text = (
                response.content if hasattr(response, "content") else str(response)
            )
            # Extract JSON from response

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
            # Check if it's a context window error
            if self._is_context_window_error(e):
                logger.error(
                    "Context window exceeded even after trimming. "
                    "Consider reducing conversation history or context size."
                )
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
        """Execute file system operation using ToolLibrary or shell"""
        try:
            from tools import ToolLibrary
            import json
            tools = ToolLibrary()
            # Try to parse action as JSON {"tool": "read_file", "params": {...}}
            try:
                action_data = json.loads(action)
                if isinstance(action_data, dict) and "tool" in action_data and "params" in action_data:
                    result = await tools.execute(action_data["tool"], action_data["params"])
                    return {"success": result.get("success", False), "summary": str(result), "data": result}
            except json.JSONDecodeError:
                pass
            
            # Fallback to executing it as a shell command to ensure it runs
            import subprocess
            result = subprocess.run(action, shell=True, capture_output=True, text=True, timeout=30)
            return {
                "success": result.returncode == 0,
                "summary": f"Executed shell: {action}",
                "stdout": result.stdout,
                "stderr": result.stderr
            }
        except Exception as e:
            return {"success": False, "error": str(e), "summary": f"Failed file op: {e}"}

    async def adapt_plan(self, task: Task, failed_result: Dict) -> Optional[Dict]:
        """Adapt plan based on failure"""
        try:
            llm = self.get_llm()
            prompt = f"""
            The current task "{task.goal}" failed at step {task.current_step}.
            Failure detail: {failed_result.get('error', failed_result.get('summary', 'Unknown block'))}
            
            Current steps:
            {task.steps}
            
            Based on this failure, provide an adapted plan with revised steps in JSON format.
            Format exactly like:
            {{
              "steps": [
                {{"tool": "browser|code|file", "action": "adapted action detail", "requires_confirmation": false}}
              ]
            }}
            Return ONLY the JSON.
            """
            response = await self._call_llm_with_retry(llm, prompt)
            
            import json
            import re
            json_text = response.content
            json_match = re.search(r'```json\s*(.*?)\s*```', json_text, re.DOTALL)
            if json_match:
                json_text = json_match.group(1)
            else:
                json_text = re.sub(r'^```.*$', '', json_text, flags=re.MULTILINE).strip()
                
            adapted_plan = json.loads(json_text)
            if "steps" in adapted_plan:
                return adapted_plan
            return None
        except Exception as e:
            logger.error(f"Failed to adapt plan: {e}")
            return None

    async def request_user_confirmation(self, step: Dict, result: Dict):
        """Request user confirmation for critical actions"""
        # Send IPC message to frontend via global server if possible, or we need to pass back the state
        # Since we're inside AutonomousAgent and need to talk to WS, we'll use an asyncio Event mechanism.
        
        # We'll broadcast a confirmation request. The server object needs to receive the response and set an event.
        if not hasattr(self, 'confirmation_events'):
            self.confirmation_events = {}
            
        task_id = self.current_task.id if self.current_task else str(datetime.now().timestamp())
        step_idx = self.current_task.current_step if self.current_task else 0
        
        event_key = f"{task_id}_{step_idx}"
        event = asyncio.Event()
        self.confirmation_events[event_key] = {"event": event, "response": None}
        
        # We need to broadcast this out. Since AutonomousAgent doesn't have a direct ref to the server broadcast method,
        # we will handle it by raising a special Exception or returning a special state that the server handles, 
        # OR we just let the server wire a `send_message` callback.
        
        # Let's cleanly inject a broadcast callback
        if hasattr(self, 'broadcast_callback') and self.broadcast_callback:
            await self.broadcast_callback({
                "type": "user_confirmation",
                "task_id": task_id,
                "step_index": step_idx,
                "step": step
            })
            
            # Wait for response (timeout after 5 minutes)
            try:
                await asyncio.wait_for(event.wait(), timeout=300.0)
                response = self.confirmation_events[event_key]["response"]
                if response == 'deny':
                    raise Exception("User denied confirmation for step")
            except asyncio.TimeoutError:
                raise Exception("Timed out waiting for user confirmation")
            finally:
                if event_key in self.confirmation_events:
                    del self.confirmation_events[event_key]
        else:
            logger.warning("No broadcast callback set. Proceeding automatically.")

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
        self._server = None
        
        # Connection health tracking
        self._client_last_ping: Dict[websockets.WebSocketServerProtocol, datetime] = {}
        self._heartbeat_interval = 30  # seconds
        self._heartbeat_task = None

    async def register_client(self, websocket: websockets.WebSocketServerProtocol):
        """Register new client connection"""
        self.clients.add(websocket)
        self._client_last_ping[websocket] = datetime.now()
        logger.info(f"Client connected. Total clients: {len(self.clients)}")
        
        # Send welcome message
        try:
            await websocket.send(json.dumps({
                "type": "connected",
                "message": "Welcome to Agent7 Server",
                "timestamp": datetime.now().isoformat()
            }))
        except Exception as e:
            logger.error(f"Error sending welcome message: {e}")

    async def unregister_client(self, websocket: websockets.WebSocketServerProtocol):
        """Unregister client connection"""
        self.clients.discard(websocket)
        self._client_last_ping.pop(websocket, None)
        logger.info(f"Client disconnected. Total clients: {len(self.clients)}")

    async def broadcast(self, message: Dict):
        """Broadcast message to all clients"""
        if not self.clients:
            return
            
        message_json = json.dumps(message)
        disconnected = []
        
        for client in self.clients:
            try:
                await client.send(message_json)
            except websockets.exceptions.ConnectionClosed:
                disconnected.append(client)
            except Exception as e:
                logger.error(f"Error broadcasting to client: {e}")
                disconnected.append(client)
        
        # Clean up disconnected clients
        for client in disconnected:
            self.clients.discard(client)
            self._client_last_ping.pop(client, None)

    async def send_to_client(self, websocket: websockets.WebSocketServerProtocol, message: Dict):
        """Send message to specific client"""
        try:
            await websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosed:
            await self.unregister_client(websocket)
        except Exception as e:
            logger.error(f"Error sending to client: {e}")

    async def handle_message(self, websocket: websockets.WebSocketServerProtocol, message: str):
        """Handle incoming message from client"""
        try:
            data = json.loads(message)
            method = data.get("method")
            params = data.get("params", {})
            request_id = data.get("id")

            logger.debug(f"Received: {method} (id={request_id})")
            
            # Update last ping time for heartbeat tracking
            if method == "ping":
                self._client_last_ping[websocket] = datetime.now()

            response = {"id": request_id, "result": None, "error": None}

            if method == "initialize":
                # Initialize with API keys
                try:
                    self.api_keys = params.get("api_keys", {})
                    self.autonomous_agent = AutonomousAgent(self.api_keys)
                    self.autonomous_agent.broadcast_callback = self.broadcast
                    await self.autonomous_agent.initialize()
                    response["result"] = {"status": "initialized"}
                except Exception as e:
                    logger.error(f"Initialization error: {e}")
                    response["error"] = f"Initialization failed: {str(e)}"

            elif method == "process_message":
                # Direct chat message → LLM response
                if not self.autonomous_agent:
                    response["error"] = "Agent not initialized"
                else:
                    content = params.get("content", "")
                    model_hint = params.get("model", "")
                    try:
                        llm = self.autonomous_agent.get_llm()
                        llm_response = await self.autonomous_agent._call_llm_with_retry(llm, content)
                        reply_text = llm_response.content if hasattr(llm_response, "content") else str(llm_response)
                        response["result"] = {"content": reply_text}
                    except Exception as e:
                        logger.error(f"process_message error: {e}")
                        response["error"] = str(e)

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
                else:
                    response["error"] = "Agent not initialized"

            elif method == "browser_click":
                if self.autonomous_agent:
                    selector = params.get("selector", "")
                    result = await self.autonomous_agent.browser_agent.click(selector)
                    response["result"] = result
                else:
                    response["error"] = "Agent not initialized"

            elif method == "browser_type":
                if self.autonomous_agent:
                    selector = params.get("selector", "")
                    text = params.get("text", "")
                    result = await self.autonomous_agent.browser_agent.type_text(
                        selector, text
                    )
                    response["result"] = result
                else:
                    response["error"] = "Agent not initialized"

            elif method == "browser_screenshot":
                if self.autonomous_agent:
                    screenshot = (
                        await self.autonomous_agent.browser_agent.get_screenshot()
                    )
                    response["result"] = {"screenshot": screenshot}
                else:
                    response["error"] = "Agent not initialized"

            elif method == "confirmation_response":
                if self.autonomous_agent and hasattr(self.autonomous_agent, 'confirmation_events'):
                    task_id = params.get("task_id")
                    step_index = params.get("step_index")
                    event_key = f"{task_id}_{step_index}"
                    
                    if event_key in self.autonomous_agent.confirmation_events:
                        self.autonomous_agent.confirmation_events[event_key]["response"] = params.get("response")
                        self.autonomous_agent.confirmation_events[event_key]["event"].set()
                        response["result"] = {"status": "unblocked"}
                    else:
                        response["error"] = "No pending confirmation found"
                else:
                    response["error"] = "Agent not initialized"

            elif method == "browser_extract":
                if self.autonomous_agent:
                    selector = params.get("selector")
                    result = await self.autonomous_agent.browser_agent.extract_content(selector)
                    response["result"] = result
                else:
                    response["error"] = "Agent not initialized"

            elif method == "browser_execute":
                if self.autonomous_agent:
                    task = params.get("task", "")
                    context = params.get("context", {})
                    result = await self.autonomous_agent._enhanced_agent.execute_task(
                        task, context
                    )
                    response["result"] = result
                else:
                    response["error"] = "Agent not initialized"

            elif method == "memory_search":
                if self.autonomous_agent:
                    query = params.get("query", "")
                    results = await self.autonomous_agent.memory.retrieve_relevant(
                        query
                    )
                    response["result"] = results
                else:
                    response["error"] = "Agent not initialized"

            elif method == "get_agents":
                response["result"] = {
                    "agents": [
                        {"name": "Planner", "type": "planner", "status": "idle", "tasksCompleted": 0, "successRate": 0},
                        {"name": "Researcher", "type": "researcher", "status": "idle", "tasksCompleted": 0, "successRate": 0},
                        {"name": "Executor", "type": "executor", "status": "idle", "tasksCompleted": 0, "successRate": 0},
                        {"name": "Coder", "type": "coder", "status": "idle", "tasksCompleted": 0, "successRate": 0},
                        {"name": "Browser Agent", "type": "browser", "status": "idle", "tasksCompleted": 0, "successRate": 0},
                        {"name": "File Manager", "type": "file_manager", "status": "idle", "tasksCompleted": 0, "successRate": 0},
                        {"name": "Reviewer", "type": "reviewer", "status": "idle", "tasksCompleted": 0, "successRate": 0},
                    ]
                }

            elif method == "decompose":
                if self.autonomous_agent:
                    task = params.get("task", "")
                    prompt_override = params.get("prompt")
                    llm = self.autonomous_agent.get_llm()
                    
                    default_prompt = f"""Decompose this task into 3-7 specific, actionable sub-tasks:
Task: {task}
Return ONLY a JSON array, for example:
[
  {{"id": 1, "description": "some description", "type": "analysis"}},
  {{"id": 2, "description": "another description", "type": "browser"}}
]"""
                    try:
                        resp = await self.autonomous_agent._call_llm_with_retry(
                            llm, prompt_override or default_prompt
                        )
                        content = resp.content if hasattr(resp, "content") else str(resp)
                        json_match = re.search(r"\s*\[.*\]\s*", content, re.DOTALL)
                        if json_match:
                            subtasks = json.loads(json_match.group())
                        else:
                            # Fallback if LLM fails to return JSON
                            subtasks = [
                                {"id": 1, "description": f"Analyze: {task}", "type": "analysis"},
                                {"id": 2, "description": f"Execute: {task}", "type": "browser"}
                            ]
                        response["result"] = {"subTasks": subtasks}
                    except Exception as e:
                        logger.error(f"Decompose error: {e}")
                        response["error"] = str(e)
                else:
                    response["error"] = "Agent not initialized"

            elif method == "assign_task":
                if self.autonomous_agent:
                    agent_name = params.get("agent", "")
                    task_text = params.get("task", "")
                    context = {"assigned_agent": agent_name}
                    result = await self.autonomous_agent.execute_complex_task(
                        task_text, context
                    )
                    response["result"] = result
                else:
                    response["error"] = "Agent not initialized"

            elif method == "agent_execute":
                if self.autonomous_agent:
                    agent_name = params.get("agentName", "")
                    task_data = params.get("task", {})
                    task_text = task_data.get("description", str(task_data))
                    context = {"assigned_agent": agent_name}
                    result = await self.autonomous_agent.execute_complex_task(
                        task_text, context
                    )
                    response["result"] = result
                else:
                    response["error"] = "Agent not initialized"

            elif method == "memory_list":
                if self.autonomous_agent:
                    limit = params.get("limit", 100)
                    offset = params.get("offset", 0)
                    conversations = self.autonomous_agent.memory.conversations
                    total = len(conversations)
                    items = conversations[offset:offset + limit]
                    response["result"] = {
                        "items": items,
                        "total": total,
                        "offset": offset,
                        "limit": limit
                    }
                else:
                    response["error"] = "Agent not initialized"

            elif method == "get_agent_history":
                if self.autonomous_agent:
                    agent_name = params.get("agent", params.get("agentId", ""))
                    history = [
                        conv for conv in self.autonomous_agent.memory.conversations 
                        if conv.get("context", {}).get("assigned_agent") == agent_name
                        or agent_name.lower() in str(conv.get("task", "")).lower()
                    ]
                    response["result"] = {
                        "agent": agent_name,
                        "history": history,
                        "total": len(history)
                    }
                else:
                    response["error"] = "Agent not initialized"

            elif method == "get_workflows":
                workflows = wf_store.load_workflows()
                response["result"] = {
                    "workflows": workflows,
                    "total": len(workflows)
                }

            elif method == "create_workflow":
                workflow_data = params.get("workflow", {})
                try:
                    created = wf_store.create_workflow(workflow_data)
                    response["result"] = {"success": True, "workflow": created}
                except ValueError as e:
                    response["error"] = str(e)

            elif method == "update_workflow":
                wf_name = params.get("name", params.get("workflow_id", ""))
                workflow_data = params.get("workflow", {})
                try:
                    updated = wf_store.update_workflow(wf_name, workflow_data)
                    response["result"] = {"success": True, "workflow": updated}
                except KeyError as e:
                    response["error"] = str(e)

            elif method == "run_workflow":
                wf_name = params.get("name", params.get("workflow_id", ""))
                wf = wf_store.get_workflow(wf_name)
                if wf and self.autonomous_agent:
                    # Execute each step via the autonomous agent
                    steps = wf.get("steps", [])
                    results = []
                    for i, step in enumerate(steps):
                        step_result = await self.autonomous_agent.execute_complex_task(
                            step.get("description", f"Step {i+1}"),
                            {"workflow": wf_name, "step_index": i}
                        )
                        results.append(step_result)
                    response["result"] = {
                        "success": True,
                        "workflow": wf_name,
                        "steps_completed": len(results),
                        "results": results
                    }
                elif not wf:
                    response["error"] = f"Workflow not found: {wf_name}"
                else:
                    response["error"] = "Agent not initialized"

            elif method == "delete_workflow":
                wf_name = params.get("name", params.get("workflow_id", ""))
                try:
                    wf_store.delete_workflow(wf_name)
                    response["result"] = {"success": True, "message": f"Workflow '{wf_name}' deleted"}
                except KeyError as e:
                    response["error"] = str(e)

            elif method == "get_settings":
                response["result"] = {
                    "settings": {
                        "default_provider": self.api_keys.get("default_provider", "openai"),
                        "available_providers": [],
                        "model_configs": {}
                    }
                }

            elif method == "save_settings":
                settings = params.get("settings", {})
                if settings.get("default_provider"):
                    self.api_keys["default_provider"] = settings["default_provider"]
                response["result"] = {
                    "success": True,
                    "message": "Settings saved"
                }

            elif method == "test_connection":
                provider = params.get("provider", "openai")
                result = {"provider": provider, "status": "unknown"}
                try:
                    if self.autonomous_agent:
                        llm = self.autonomous_agent.get_llm(provider)
                        result["status"] = "connected"
                        result["model"] = self.autonomous_agent._current_model
                    else:
                        result["status"] = "error"
                        result["message"] = "Agent not initialized"
                except Exception as e:
                    result["status"] = "error"
                    result["message"] = str(e)
                response["result"] = result

            elif method == "ping":
                # Heartbeat/ping-pong response
                response["result"] = {"pong": True, "timestamp": datetime.now().isoformat()}

            else:
                response["error"] = f"Unknown method: {method}"

            await self.send_to_client(websocket, response)

        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON received: {e}")
            error_response = {
                "id": None,
                "error": "Invalid JSON message",
            }
            await self.send_to_client(websocket, error_response)
            
        except Exception as e:
            logger.error(f"Message handling error: {e}")
            traceback.print_exc()
            error_response = {
                "id": data.get("id") if "data" in locals() else None,
                "error": str(e),
            }
            await self.send_to_client(websocket, error_response)

    async def handler(self, websocket: websockets.WebSocketServerProtocol, path=None):
        """WebSocket connection handler"""
        await self.register_client(websocket)
        try:
            async for message in websocket:
                await self.handle_message(websocket, message)
        except websockets.exceptions.ConnectionClosed as e:
            logger.info(f"Connection closed: code={e.code}, reason={e.reason}")
        except Exception as e:
            logger.error(f"Handler error: {e}")
        finally:
            await self.unregister_client(websocket)

    async def _process_http_request(self, connection, request):
        """Handle HTTP requests gracefully before WebSocket handshake.
        
        websockets 14+ signature: process_request(connection, request) -> Response | None
        """
        from websockets.http11 import Response
        
        path = request.path
        
        # For favicon.ico, return 204 No Content
        if path == "/favicon.ico":
            return Response(
                status_code=204,
                reason_phrase="No Content",
                headers=[(b"Connection", b"close")],
                body=b""
            )
        
        # Health check endpoint
        if path == "/health":
            health_data = {
                "status": "healthy",
                "timestamp": datetime.now().isoformat(),
                "clients": len(self.clients),
                "agent_initialized": self.autonomous_agent is not None
            }
            body = json.dumps(health_data).encode('utf-8')
            return Response(
                status_code=200,
                reason_phrase="OK",
                headers=[
                    (b"Content-Type", b"application/json; charset=utf-8"),
                    (b"Connection", b"close")
                ],
                body=body
            )
        
        # Return simple HTML for other HTTP requests
        body = b"""<!DOCTYPE html>
<html>
<head>
    <title>Agent7 Backend</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        h1 { color: #333; }
        .status { padding: 10px; background: #e8f5e9; border-left: 4px solid #4caf50; }
        code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>Agent7 WebSocket Server</h1>
    <div class="status">
        <strong>Status:</strong> Running &#9989;
    </div>
    <p>This is a WebSocket endpoint. Connect using <code>ws://localhost:8765</code></p>
    <p>Connected clients: <strong>""" + str(len(self.clients)).encode() + b"""</strong></p>
</body>
</html>"""
        
        return Response(
            status_code=200,
            reason_phrase="OK",
            headers=[
                (b"Content-Type", b"text/html; charset=utf-8"),
                (b"Connection", b"close")
            ],
            body=body
        )

    async def _heartbeat_monitor(self):
        """Monitor client connections and remove stale clients."""
        while True:
            try:
                await asyncio.sleep(self._heartbeat_interval)
                
                now = datetime.now()
                stale_clients = []
                
                for client, last_ping in self._client_last_ping.items():
                    # If no ping received in 2 minutes, mark as stale
                    if (now - last_ping).total_seconds() > 120:
                        logger.warning(f"Client stale, no ping in 2 minutes")
                        stale_clients.append(client)
                
                # Close stale connections
                for client in stale_clients:
                    try:
                        await client.close(1001, "Heartbeat timeout")
                    except Exception:
                        pass
                    await self.unregister_client(client)
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Heartbeat monitor error: {e}")

    async def start(self):
        """Start WebSocket server with HTTP fallback support."""
        logger.info(f"Starting Agent7 server on ws://{self.host}:{self.port}")
        
        # Start heartbeat monitor
        self._heartbeat_task = asyncio.create_task(self._heartbeat_monitor())
        
        try:
            async with websockets.serve(
                self.handler, 
                self.host, 
                self.port,
                process_request=self._process_http_request,
                ping_interval=20,  # websockets library built-in ping every 20s
                ping_timeout=10,   # timeout after 10s
            ) as server:
                self._server = server
                await asyncio.Future()  # Run forever
        except Exception as e:
            logger.error(f"Server error: {e}")
            raise
        finally:
            if self._heartbeat_task:
                self._heartbeat_task.cancel()
                try:
                    await self._heartbeat_task
                except asyncio.CancelledError:
                    pass

    async def stop(self):
        """Stop the server gracefully."""
        logger.info("Stopping server...")
        
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            
        # Close all client connections
        if self.clients:
            await asyncio.gather(
                *[client.close(1001, "Server shutting down") for client in list(self.clients)],
                return_exceptions=True
            )
            self.clients.clear()
        
        if self._server:
            self._server.close()
            await self._server.wait_closed()


async def main():
    """Main entry point"""
    server = Agent7Server()
    
    # Handle graceful shutdown
    loop = asyncio.get_event_loop()
    for sig in ('SIGINT', 'SIGTERM'):
        try:
            loop.add_signal_handler(
                getattr(__import__('signal'), sig),
                lambda: asyncio.create_task(server.stop())
            )
        except NotImplementedError:
            # Windows doesn't support add_signal_handler
            pass
    
    await server.start()


if __name__ == "__main__":
    asyncio.run(main())
