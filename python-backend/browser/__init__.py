"""Browser automation package for Agent7."""

from browser.config import BrowserConfig as AgentBrowserConfig

__all__ = ["AgentBrowserConfig"]

# Conditional imports: modules with heavy dependencies are only exported
# when those dependencies are installed.

try:
    from browser.reliable_browser import ReliableBrowser, CircuitBreakerOpen
    __all__ += ["ReliableBrowser", "CircuitBreakerOpen"]
except ImportError:
    pass

try:
    from browser.session_manager import SessionManager
    __all__ += ["SessionManager"]
except ImportError:
    pass

try:
    from browser.smart_vision import SmartVision, PageState
    __all__ += ["SmartVision", "PageState"]
except ImportError:
    pass

try:
    from browser.enhanced_agent import EnhancedAgent, TaskExecutionMemory
    __all__ += ["EnhancedAgent", "TaskExecutionMemory"]
except ImportError:
    pass

try:
    from browser.orchestrator import AgentOrchestrator, SpecializedAgent, TaskDecomposition
    __all__ += ["AgentOrchestrator", "SpecializedAgent", "TaskDecomposition"]
except ImportError:
    pass
