import pytest
from unittest.mock import patch, MagicMock


class TestBedrockProvider:
    def test_get_llm_bedrock_returns_chat_model(self):
        """Test that get_llm('bedrock') returns a ChatBedrockConverse instance."""
        from server import AutonomousAgent

        agent = AutonomousAgent.__new__(AutonomousAgent)
        agent.api_keys = {
            "bedrock": {
                "aws_access_key_id": "AKIAIOSFODNN7EXAMPLE",
                "aws_secret_access_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
                "region": "us-east-1",
                "model_id": "anthropic.claude-3-5-sonnet-20241022-v2:0",
            }
        }
        with patch("server.ChatBedrockConverse") as MockBedrock:
            mock_instance = MagicMock()
            MockBedrock.return_value = mock_instance
            llm = agent.get_llm("bedrock")
            MockBedrock.assert_called_once()
            call_kwargs = MockBedrock.call_args[1]
            assert call_kwargs["model_id"] == "anthropic.claude-3-5-sonnet-20241022-v2:0"
            assert call_kwargs["region_name"] == "us-east-1"

    def test_get_llm_bedrock_default_model(self):
        """Test that bedrock defaults to Claude if no model_id specified."""
        from server import AutonomousAgent

        agent = AutonomousAgent.__new__(AutonomousAgent)
        agent.api_keys = {
            "bedrock": {
                "aws_access_key_id": "AKIAIOSFODNN7EXAMPLE",
                "aws_secret_access_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
                "region": "us-east-1",
            }
        }
        with patch("server.ChatBedrockConverse") as MockBedrock:
            MockBedrock.return_value = MagicMock()
            agent.get_llm("bedrock")
            call_kwargs = MockBedrock.call_args[1]
            assert "claude" in call_kwargs["model_id"].lower()

    def test_get_llm_bedrock_missing_keys_raises(self):
        """Test that missing bedrock credentials raises ValueError."""
        from server import AutonomousAgent

        agent = AutonomousAgent.__new__(AutonomousAgent)
        agent.api_keys = {}
        with pytest.raises(ValueError, match="No API key available"):
            agent.get_llm("bedrock")

    def test_get_llm_bedrock_in_fallback_chain(self):
        """Test that bedrock is tried in the fallback chain when other providers unavailable."""
        from server import AutonomousAgent

        agent = AutonomousAgent.__new__(AutonomousAgent)
        agent.api_keys = {
            "bedrock": {
                "aws_access_key_id": "AKIAIOSFODNN7EXAMPLE",
                "aws_secret_access_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
                "region": "us-east-1",
            }
        }
        with patch("server.ChatBedrockConverse") as MockBedrock:
            MockBedrock.return_value = MagicMock()
            # No openai/anthropic/google keys — should fall back to bedrock
            llm = agent.get_llm()
            MockBedrock.assert_called_once()
