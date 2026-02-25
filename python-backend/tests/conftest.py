"""
Conftest providing mock modules for heavy dependencies that aren't installed
in the test environment.  This lets `import server` succeed so that unit tests
can exercise individual methods (like get_llm) with targeted patching.
"""

import sys
import types
from unittest.mock import MagicMock


def _ensure_mock_module(name, attrs=None):
    """Register a lightweight mock module if the real one is missing."""
    if name not in sys.modules:
        mod = types.ModuleType(name)
        mod.__dict__.update(attrs or {})
        # Make any attribute access return a MagicMock
        mod.__getattr__ = lambda self_name: MagicMock()
        sys.modules[name] = mod


# --- Heavy third-party packages that server.py imports at the top level ---

_ensure_mock_module("websockets")
_ensure_mock_module("websockets.exceptions", {"ConnectionClosed": type("ConnectionClosed", (Exception,), {})})

# browser_use ecosystem
for mod_name in [
    "browser_use",
    "browser_use.agent",
    "browser_use.agent.views",
    "browser_use.browser",
    "browser_use.browser.context",
]:
    _ensure_mock_module(mod_name)

# LangChain providers
_ensure_mock_module("langchain_openai", {"ChatOpenAI": MagicMock()})
_ensure_mock_module("langchain_anthropic", {"ChatAnthropic": MagicMock()})
_ensure_mock_module("langchain_google_genai", {"ChatGoogleGenerativeAI": MagicMock()})
_ensure_mock_module("langchain_aws", {"ChatBedrockConverse": MagicMock()})

# PIL / Pillow
_ensure_mock_module("PIL")
_ensure_mock_module("PIL.Image")
