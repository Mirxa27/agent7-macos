import pytest
from browser.config import BrowserConfig as AgentBrowserConfig


class TestBrowserConfig:
    def test_default_timeouts(self):
        config = AgentBrowserConfig()
        assert config.navigate_timeout == 30_000
        assert config.click_timeout == 10_000
        assert config.type_timeout == 10_000
        assert config.extract_timeout == 15_000
        assert config.screenshot_timeout == 10_000

    def test_default_retry(self):
        config = AgentBrowserConfig()
        assert config.max_retries == 3
        assert config.retry_base_delay == 1.0
        assert config.circuit_breaker_threshold == 5

    def test_default_session(self):
        config = AgentBrowserConfig()
        assert config.max_contexts == 3
        assert config.max_tabs_per_context == 10
        assert config.idle_timeout == 300
        assert config.health_check_interval == 30
        assert config.max_memory_mb == 1024

    def test_custom_values(self):
        config = AgentBrowserConfig(max_retries=5, navigate_timeout=60_000)
        assert config.max_retries == 5
        assert config.navigate_timeout == 60_000
        # Other defaults unchanged
        assert config.click_timeout == 10_000

    def test_macos_chromium_args(self):
        config = AgentBrowserConfig()
        args = config.chromium_args
        assert "--disable-dev-shm-usage" in args
        assert "--disable-features=TranslateUI" in args
        # Linux-only flags must NOT be present
        assert "--no-sandbox" not in args
        assert "--single-process" not in args
        assert "--no-zygote" not in args

    def test_retryable_errors(self):
        config = AgentBrowserConfig()
        assert "timeout" in config.retryable_errors
        assert "target closed" in config.retryable_errors
        assert "navigation failed" in config.retryable_errors
        assert "element is detached" in config.retryable_errors
        assert "frame was detached" in config.retryable_errors
        assert "execution context was destroyed" in config.retryable_errors
        assert "connection refused" in config.retryable_errors
        assert "net::ERR_CONNECTION_RESET" in config.retryable_errors
