import os
import unittest
from unittest.mock import patch

os.environ.setdefault("GROQ_API_KEY", "test-key")

from langchain_core.messages import AIMessage

from backend.services import _prepare_prompt_inputs


class PromptBudgetTests(unittest.TestCase):
    def test_keeps_recent_history_within_remaining_budget(self):
        history = [
            {"role": "user", "content": "old"},
            {"role": "assistant", "content": "latest answer"},
        ]

        with patch("backend.services.MAX_PROMPT_CONTENT_CHARACTERS", 12):
            messages, context = _prepare_prompt_inputs(
                message="query",
                history=history,
                context="ctx",
            )

        self.assertEqual(context, "ctx")
        self.assertEqual(len(messages), 1)
        self.assertIsInstance(messages[0], AIMessage)
        self.assertEqual(messages[0].content, "swer")
        self.assertLessEqual(
            len("query") + len(context) + len(messages[0].content),
            12,
        )

    def test_prioritizes_user_message_and_document_context_over_history(self):
        with patch("backend.services.MAX_PROMPT_CONTENT_CHARACTERS", 12):
            messages, context = _prepare_prompt_inputs(
                message="query",
                history=[{"role": "user", "content": "old"}],
                context="long document context",
            )

        self.assertEqual(context, "long do")
        self.assertEqual(messages, [])


if __name__ == "__main__":
    unittest.main()
