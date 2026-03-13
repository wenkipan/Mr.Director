"""User interaction tools: present_plan, ask_user."""

from __future__ import annotations

from app.tools.registry import registry


@registry.register(
    name="present_plan",
    description=(
        "Present an editing plan to the user for review before executing. Stops the agent loop. "
        "\n\nWhen to use: the edit is complex or ambiguous — multiple clips, structural changes, "
        "or decisions that the user should approve first. "
        "When NOT to use: simple, unambiguous operations (just do it and explain after)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "summary": {
                "type": "STRING",
                "description": "A clear summary of the editing plan you want to execute",
            },
        },
        "required": ["summary"],
    },
)
async def present_plan(args: dict, state) -> dict:
    return {
        "presented": True,
        "summary": args["summary"],
        "note": "Plan has been shown to the user. Proceed with implementation.",
    }


@registry.register(
    name="ask_user",
    description=(
        "Ask the user a clarifying question. Stops the agent loop and waits for their reply. "
        "\n\nWhen to use: the user's intent is genuinely ambiguous and guessing wrong would waste work. "
        "When NOT to use: you can reasonably infer the answer from context — prefer action over asking."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "question": {
                "type": "STRING",
                "description": "The question to ask the user",
            },
        },
        "required": ["question"],
    },
)
async def ask_user(args: dict, state) -> dict:
    # In the current implementation, the agent loop will return the question
    # as a text response. The user's reply comes as the next chat message.
    return {
        "question_asked": True,
        "question": args["question"],
        "note": "Question relayed to the user. Wait for their response in the next message.",
    }
