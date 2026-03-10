"""Browser automation package for Agent7."""

import logging

logger = logging.getLogger(__name__)

# Import config - this should always work as it has no external deps
from browser.config import BrowserConfig as AgentBrowserConfig

__all__ = ["AgentBrowserConfig"]

# Conditional imports: modules with heavy dependencies are only exported
# when those dependencies are installed.

# ReliableBrowser
try:
    from browser.reliable_browser import ReliableBrowser, CircuitBreakerOpen
    __all__ += ["ReliableBrowser", "CircuitBreakerOpen"]
    logger.debug("ReliableBrowser imported successfully")
except ImportError as e:
    logger.warning(f"ReliableBrowser not available: {e}")
    
    class CircuitBreakerOpen(Exception):
        """Raised when the circuit breaker has tripped."""
        pass
    
    class ReliableBrowser:
        """Stub ReliableBrowser when dependencies are missing."""
        def __init__(self, *args, **kwargs):
            raise RuntimeError(
                "ReliableBrowser requires browser-use and playwright. "
                "Install with: pip install browser-use playwright"
            )
    
    __all__ += ["ReliableBrowser", "CircuitBreakerOpen"]

# SessionManager
try:
    from browser.session_manager import SessionManager
    __all__ += ["SessionManager"]
    logger.debug("SessionManager imported successfully")
except ImportError as e:
    logger.warning(f"SessionManager not available: {e}")
    
    class SessionManager:
        """Stub SessionManager when dependencies are missing."""
        def __init__(self, *args, **kwargs):
            raise RuntimeError(
                "SessionManager requires browser-use and playwright. "
                "Install with: pip install browser-use playwright"
            )
    
    __all__ += ["SessionManager"]

# SmartVision
try:
    from browser.smart_vision import SmartVision, PageState
    __all__ += ["SmartVision", "PageState"]
    logger.debug("SmartVision imported successfully")
except ImportError as e:
    logger.warning(f"SmartVision not available: {e}")
    from dataclasses import dataclass, field
    from typing import Any, Dict, List
    
    @dataclass
    class PageState:
        """Fallback PageState when smart_vision is unavailable."""
        url: str = ""
        title: str = ""
        visible_text: str = ""
        form_fields: List[Dict[str, Any]] = field(default_factory=list)
        timestamp: str = ""
    
    class SmartVision:
        """Stub SmartVision when dependencies are missing."""
        def __init__(self, *args, **kwargs):
            raise RuntimeError(
                "SmartVision requires opencv-python and pytesseract. "
                "Install with: pip install opencv-python pytesseract"
            )
    
    __all__ += ["SmartVision", "PageState"]

# EnhancedAgent
try:
    from browser.enhanced_agent import EnhancedAgent, TaskExecutionMemory
    __all__ += ["EnhancedAgent", "TaskExecutionMemory"]
    logger.debug("EnhancedAgent imported successfully")
except ImportError as e:
    logger.warning(f"EnhancedAgent not available: {e}")
    from dataclasses import dataclass, field
    from typing import Any, Dict, List
    from collections import defaultdict
    from datetime import datetime
    
    class TaskExecutionMemory:
        """Fallback TaskExecutionMemory."""
        def __init__(self):
            self._history: Dict[str, List[Dict]] = defaultdict(list)
        
        def record_action(self, domain: str, action: str, selector: str, success: bool):
            self._history[domain].append({
                "action": action,
                "selector": selector,
                "success": success,
                "timestamp": datetime.now().isoformat(),
            })
        
        def get_domain_history(self, domain: str) -> List[Dict]:
            return self._history.get(domain, [])
        
        def get_working_selectors(self, domain: str) -> List[str]:
            return []
    
    class EnhancedAgent:
        """Stub EnhancedAgent when dependencies are missing."""
        def __init__(self, *args, **kwargs):
            raise RuntimeError(
                "EnhancedAgent requires browser-use and langchain. "
                "Install with: pip install browser-use langchain langchain-openai"
            )
    
    __all__ += ["EnhancedAgent", "TaskExecutionMemory"]

# Orchestrator
try:
    from browser.orchestrator import AgentOrchestrator, SpecializedAgent, TaskDecomposition
    __all__ += ["AgentOrchestrator", "SpecializedAgent", "TaskDecomposition"]
    logger.debug("Orchestrator imported successfully")
except ImportError as e:
    logger.warning(f"Orchestrator not available: {e}")
    from dataclasses import dataclass, field
    from typing import Any, Dict, List
    
    @dataclass
    class TaskDecomposition:
        """Fallback TaskDecomposition."""
        goal: str = ""
        steps: List[Dict[str, Any]] = field(default_factory=list)
        agents: List[str] = field(default_factory=list)
    
    class SpecializedAgent:
        """Fallback SpecializedAgent."""
        def __init__(self, name: str, agent_type: str, config: Dict = None):
            self.name = name
            self.type = agent_type
            self.config = config or {}
    
    class AgentOrchestrator:
        """Stub AgentOrchestrator when dependencies are missing."""
        def __init__(self, *args, **kwargs):
            raise RuntimeError(
                "AgentOrchestrator requires langchain. "
                "Install with: pip install langchain langchain-openai"
            )
    
    __all__ += ["AgentOrchestrator", "SpecializedAgent", "TaskDecomposition"]

logger.info(f"Browser package initialized. Available exports: {__all__}")
