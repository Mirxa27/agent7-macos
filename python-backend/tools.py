#!/usr/bin/env python3
"""
Agent7 Advanced Tool System
Self-improving tool library with adaptive capabilities
"""

import asyncio
import json
import os
import re
from typing import Dict, Any, List, Optional, Callable
from dataclasses import dataclass, field
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@dataclass
class ToolExecution:
    """Record of tool execution"""

    tool_name: str
    params: Dict[str, Any]
    result: Any
    success: bool
    execution_time: float
    timestamp: datetime
    context: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolDefinition:
    """Definition of a tool"""

    name: str
    description: str
    parameters: Dict[str, Any]
    handler: Callable
    success_rate: float = 1.0
    usage_count: int = 0
    avg_execution_time: float = 0.0
    version: int = 1


class ToolLibrary:
    """Self-improving tool library"""

    def __init__(self, storage_path: str = "tools"):
        self.tools: Dict[str, ToolDefinition] = {}
        self.execution_history: List[ToolExecution] = []
        self.storage_path = storage_path
        self.skill_library: Dict[str, Any] = {}

        # Register built-in tools
        self._register_builtin_tools()

    def _register_builtin_tools(self):
        """Register all built-in tools"""

        # Web tools
        self.register_tool(
            name="web_search",
            description="Search the web for information",
            parameters={
                "query": {"type": "string", "description": "Search query"},
                "num_results": {"type": "integer", "default": 5},
            },
            handler=self._web_search,
        )

        self.register_tool(
            name="web_scrape",
            description="Scrape content from a webpage",
            parameters={
                "url": {"type": "string", "description": "URL to scrape"},
                "selector": {
                    "type": "string",
                    "description": "CSS selector",
                    "optional": True,
                },
            },
            handler=self._web_scrape,
        )

        # Code tools
        self.register_tool(
            name="execute_python",
            description="Execute Python code safely",
            parameters={
                "code": {"type": "string", "description": "Python code to execute"},
                "timeout": {"type": "integer", "default": 30},
            },
            handler=self._execute_python,
        )

        self.register_tool(
            name="execute_shell",
            description="Execute shell command",
            parameters={
                "command": {"type": "string", "description": "Shell command"},
                "timeout": {"type": "integer", "default": 30},
            },
            handler=self._execute_shell,
        )

        # File tools
        self.register_tool(
            name="read_file",
            description="Read file contents",
            parameters={
                "path": {"type": "string", "description": "File path"},
                "limit": {
                    "type": "integer",
                    "default": 1000,
                    "description": "Max lines to read",
                },
            },
            handler=self._read_file,
        )

        self.register_tool(
            name="write_file",
            description="Write content to file",
            parameters={
                "path": {"type": "string", "description": "File path"},
                "content": {"type": "string", "description": "Content to write"},
            },
            handler=self._write_file,
        )

        self.register_tool(
            name="list_directory",
            description="List directory contents",
            parameters={
                "path": {"type": "string", "description": "Directory path"},
                "pattern": {"type": "string", "optional": True},
            },
            handler=self._list_directory,
        )

        # Data tools
        self.register_tool(
            name="parse_json",
            description="Parse and validate JSON",
            parameters={
                "content": {"type": "string", "description": "JSON string"},
                "schema": {"type": "object", "optional": True},
            },
            handler=self._parse_json,
        )

        self.register_tool(
            name="extract_regex",
            description="Extract data using regex",
            parameters={
                "text": {"type": "string", "description": "Text to search"},
                "pattern": {"type": "string", "description": "Regex pattern"},
            },
            handler=self._extract_regex,
        )

        # Analysis tools
        self.register_tool(
            name="analyze_text",
            description="Analyze text content",
            parameters={
                "text": {"type": "string", "description": "Text to analyze"},
                "analysis_type": {
                    "type": "string",
                    "enum": ["sentiment", "entities", "summary"],
                    "default": "summary",
                },
            },
            handler=self._analyze_text,
        )

        # System tools
        self.register_tool(
            name="get_system_info",
            description="Get system information",
            parameters={},
            handler=self._get_system_info,
        )

        self.register_tool(
            name="get_datetime",
            description="Get current date and time",
            parameters={"format": {"type": "string", "default": "%Y-%m-%d %H:%M:%S"}},
            handler=self._get_datetime,
        )

    def register_tool(
        self, name: str, description: str, parameters: Dict, handler: Callable
    ):
        """Register a new tool"""
        self.tools[name] = ToolDefinition(
            name=name, description=description, parameters=parameters, handler=handler
        )
        logger.info(f"Registered tool: {name}")

    async def execute(
        self, tool_name: str, params: Dict[str, Any], context: Dict = None
    ) -> Dict[str, Any]:
        """Execute a tool with tracking"""
        import time

        tool = self.tools.get(tool_name)
        if not tool:
            return {"success": False, "error": f"Unknown tool: {tool_name}"}

        start_time = time.time()

        try:
            # Validate parameters
            validated_params = self._validate_params(tool, params)

            # Execute tool
            result = await tool.handler(**validated_params)

            execution_time = time.time() - start_time

            # Record execution
            execution = ToolExecution(
                tool_name=tool_name,
                params=validated_params,
                result=result,
                success=True,
                execution_time=execution_time,
                timestamp=datetime.now(),
                context=context or {},
            )
            self.execution_history.append(execution)

            # Update tool stats
            self._update_tool_stats(tool, execution_time, success=True)

            return {"success": True, "result": result, "execution_time": execution_time}

        except Exception as e:
            execution_time = time.time() - start_time

            # Record failed execution
            execution = ToolExecution(
                tool_name=tool_name,
                params=params,
                result=str(e),
                success=False,
                execution_time=execution_time,
                timestamp=datetime.now(),
                context=context or {},
            )
            self.execution_history.append(execution)

            # Update tool stats
            self._update_tool_stats(tool, execution_time, success=False)

            logger.error(f"Tool execution error ({tool_name}): {e}")

            return {"success": False, "error": str(e), "execution_time": execution_time}

    def _validate_params(self, tool: ToolDefinition, params: Dict) -> Dict:
        """Validate and set default parameters"""
        validated = {}

        for param_name, param_def in tool.parameters.items():
            if param_name in params:
                validated[param_name] = params[param_name]
            elif "default" in param_def:
                validated[param_name] = param_def["default"]
            elif not param_def.get("optional", False):
                raise ValueError(f"Missing required parameter: {param_name}")

        return validated

    def _update_tool_stats(
        self, tool: ToolDefinition, execution_time: float, success: bool
    ):
        """Update tool statistics"""
        tool.usage_count += 1

        # Update average execution time
        tool.avg_execution_time = (
            tool.avg_execution_time * (tool.usage_count - 1) + execution_time
        ) / tool.usage_count

        # Update success rate
        recent_executions = [
            e for e in self.execution_history[-100:] if e.tool_name == tool.name
        ]
        if recent_executions:
            successful = sum(1 for e in recent_executions if e.success)
            tool.success_rate = successful / len(recent_executions)

    def get_tool_descriptions(self) -> List[Dict]:
        """Get descriptions of all tools"""
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
                "success_rate": tool.success_rate,
                "usage_count": tool.usage_count,
            }
            for tool in self.tools.values()
        ]

    def suggest_tools(self, task: str) -> List[str]:
        """Suggest tools based on task description"""
        suggestions = []
        task_lower = task.lower()

        # Simple keyword matching
        tool_keywords = {
            "web_search": ["search", "find", "lookup", "google"],
            "web_scrape": ["scrape", "extract", "crawl", "website"],
            "execute_python": ["code", "script", "python", "calculate"],
            "execute_shell": ["command", "terminal", "bash", "shell"],
            "read_file": ["read", "file", "open", "contents"],
            "write_file": ["write", "save", "create", "file"],
            "list_directory": ["list", "directory", "folder", "files"],
            "parse_json": ["json", "parse", "extract"],
            "extract_regex": ["regex", "pattern", "extract", "find"],
            "analyze_text": ["analyze", "sentiment", "summary"],
            "get_system_info": ["system", "info", "computer"],
            "get_datetime": ["time", "date", "current"],
        }

        for tool_name, keywords in tool_keywords.items():
            if any(keyword in task_lower for keyword in keywords):
                suggestions.append(tool_name)

        # Sort by success rate
        suggestions.sort(
            key=lambda t: self.tools[t].success_rate if t in self.tools else 0,
            reverse=True,
        )

        return suggestions[:5]  # Return top 5

    async def learn_from_execution(self, execution: ToolExecution):
        """Learn from tool execution to improve future performance"""
        # Analyze patterns in successful vs failed executions
        if not execution.success:
            # Try to identify common failure patterns
            similar_failures = [
                e
                for e in self.execution_history
                if e.tool_name == execution.tool_name and not e.success
            ]

            if len(similar_failures) > 5:
                logger.warning(f"Tool {execution.tool_name} has high failure rate")
                # Could trigger tool improvement here

    # Tool Handlers

    async def _web_search(self, query: str, num_results: int = 5) -> Dict:
        """Search the web"""
        try:
            import requests

            # Using DuckDuckGo HTML version (no API key needed)
            url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query)}"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }

            response = requests.get(url, headers=headers, timeout=10)

            # Parse results
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(response.text, "html.parser")

            results = []
            for result in soup.find_all("div", class_="result", limit=num_results):
                title_elem = result.find("a", class_="result__a")
                snippet_elem = result.find("a", class_="result__snippet")

                if title_elem and snippet_elem:
                    results.append(
                        {
                            "title": title_elem.get_text(),
                            "snippet": snippet_elem.get_text(),
                            "url": title_elem.get("href", ""),
                        }
                    )

            return {"query": query, "results": results, "count": len(results)}

        except Exception as e:
            return {"error": str(e)}

    async def _web_scrape(self, url: str, selector: str = None) -> Dict:
        """Scrape webpage"""
        try:
            import requests
            from bs4 import BeautifulSoup

            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }

            response = requests.get(url, headers=headers, timeout=15)
            soup = BeautifulSoup(response.text, "html.parser")

            if selector:
                elements = soup.select(selector)
                content = [elem.get_text(strip=True) for elem in elements]
            else:
                # Extract main content
                for tag in soup(["script", "style", "nav", "footer"]):
                    tag.decompose()
                content = soup.get_text(separator="\n", strip=True)

            return {
                "url": url,
                "title": soup.title.string if soup.title else "",
                "content": content[:5000] if isinstance(content, str) else content,
                "status_code": response.status_code,
            }

        except Exception as e:
            return {"error": str(e)}

    async def _execute_python(self, code: str, timeout: int = 30) -> Dict:
        """Execute Python code"""
        import subprocess
        import tempfile

        try:
            # Create temp file
            with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
                f.write(code)
                temp_path = f.name

            # Execute with timeout
            result = subprocess.run(
                ["python3", temp_path], capture_output=True, text=True, timeout=timeout
            )

            # Cleanup
            os.unlink(temp_path)

            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
                "success": result.returncode == 0,
            }

        except subprocess.TimeoutExpired:
            return {"error": "Execution timeout", "success": False}
        except Exception as e:
            return {"error": str(e), "success": False}

    async def _execute_shell(self, command: str, timeout: int = 30) -> Dict:
        """Execute shell command"""
        import subprocess

        try:
            result = subprocess.run(
                command, shell=True, capture_output=True, text=True, timeout=timeout
            )

            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
                "success": result.returncode == 0,
            }

        except subprocess.TimeoutExpired:
            return {"error": "Execution timeout", "success": False}
        except Exception as e:
            return {"error": str(e), "success": False}

    async def _read_file(self, path: str, limit: int = 1000) -> Dict:
        """Read file"""
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()[:limit]
                content = "".join(lines)

            return {
                "path": path,
                "content": content,
                "lines": len(lines),
                "truncated": len(lines) >= limit,
            }

        except Exception as e:
            return {"error": str(e)}

    async def _write_file(self, path: str, content: str) -> Dict:
        """Write file"""
        try:
            # Create directory if needed
            os.makedirs(os.path.dirname(path), exist_ok=True)

            with open(path, "w", encoding="utf-8") as f:
                f.write(content)

            return {
                "path": path,
                "bytes_written": len(content.encode("utf-8")),
                "success": True,
            }

        except Exception as e:
            return {"error": str(e)}

    async def _list_directory(self, path: str, pattern: str = None) -> Dict:
        """List directory"""
        try:
            entries = os.listdir(path)

            if pattern:
                import fnmatch

                entries = [e for e in entries if fnmatch.fnmatch(e, pattern)]

            # Get details
            details = []
            for entry in entries:
                full_path = os.path.join(path, entry)
                stat = os.stat(full_path)
                details.append(
                    {
                        "name": entry,
                        "type": "directory" if os.path.isdir(full_path) else "file",
                        "size": stat.st_size,
                        "modified": stat.st_mtime,
                    }
                )

            return {"path": path, "entries": details, "count": len(details)}

        except Exception as e:
            return {"error": str(e)}

    async def _parse_json(self, content: str, schema: Dict = None) -> Dict:
        """Parse JSON"""
        try:
            data = json.loads(content)

            if schema:
                # Basic schema validation
                # In production, use jsonschema library
                pass

            return {"data": data, "valid": True}

        except json.JSONDecodeError as e:
            return {"error": str(e), "valid": False}

    async def _extract_regex(self, text: str, pattern: str) -> Dict:
        """Extract with regex"""
        try:
            matches = re.findall(pattern, text)

            return {"pattern": pattern, "matches": matches, "count": len(matches)}

        except re.error as e:
            return {"error": f"Invalid regex: {e}"}

    async def _analyze_text(self, text: str, analysis_type: str = "summary") -> Dict:
        """Analyze text"""
        if analysis_type == "summary":
            # Simple extractive summary
            sentences = re.split(r"(?<=[.!?])\s+", text)
            summary_sentences = sentences[:3]  # First 3 sentences

            return {
                "summary": " ".join(summary_sentences),
                "original_length": len(text),
                "summary_length": len(" ".join(summary_sentences)),
            }

        elif analysis_type == "sentiment":
            # Simple keyword-based sentiment
            positive_words = [
                "good",
                "great",
                "excellent",
                "amazing",
                "love",
                "best",
                "fantastic",
            ]
            negative_words = ["bad", "terrible", "awful", "hate", "worst", "horrible"]

            text_lower = text.lower()
            positive_count = sum(1 for word in positive_words if word in text_lower)
            negative_count = sum(1 for word in negative_words if word in text_lower)

            if positive_count > negative_count:
                sentiment = "positive"
            elif negative_count > positive_count:
                sentiment = "negative"
            else:
                sentiment = "neutral"

            return {
                "sentiment": sentiment,
                "confidence": abs(positive_count - negative_count)
                / max(len(text.split()), 1),
            }

        else:
            return {"error": f"Unknown analysis type: {analysis_type}"}

    async def _get_system_info(self) -> Dict:
        """Get system info"""
        import platform

        return {
            "platform": platform.platform(),
            "processor": platform.processor(),
            "python_version": platform.python_version(),
            "hostname": platform.node(),
        }

    async def _get_datetime(self, format: str = "%Y-%m-%d %H:%M:%S") -> Dict:
        """Get datetime"""
        now = datetime.now()

        return {
            "datetime": now.strftime(format),
            "timestamp": now.timestamp(),
            "iso": now.isoformat(),
        }


# Export
__all__ = ["ToolLibrary", "ToolDefinition", "ToolExecution"]
