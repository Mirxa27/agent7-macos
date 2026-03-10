"""Configuration defaults for the browser automation package."""

from dataclasses import dataclass, field
from typing import List


@dataclass
class BrowserConfig:
    """All configurable defaults for browser automation layers."""

    # Timeouts (milliseconds)
    navigate_timeout: int = 30_000
    click_timeout: int = 10_000
    type_timeout: int = 10_000
    extract_timeout: int = 15_000
    screenshot_timeout: int = 10_000
    wait_for_selector_timeout: int = 10_000

    # Retry settings
    max_retries: int = 3
    retry_base_delay: float = 1.0  # seconds, doubles each attempt
    circuit_breaker_threshold: int = 5  # consecutive failures before tripping

    # Session settings
    max_contexts: int = 3
    max_tabs_per_context: int = 10
    idle_timeout: int = 300  # seconds
    health_check_interval: int = 30  # seconds
    max_memory_mb: int = 1024

    # macOS-optimized Chromium args
    chromium_args: List[str] = field(default_factory=lambda: [
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--disable-gpu",
        "--disable-features=TranslateUI",
    ])

    # Errors that are safe to retry
    retryable_errors: List[str] = field(default_factory=lambda: [
        "timeout",
        "target closed",
        "navigation failed",
        "element is detached",
        "frame was detached",
        "execution context was destroyed",
        "connection refused",
        "net::ERR_CONNECTION_RESET",
    ])
