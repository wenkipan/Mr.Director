from google import genai
from google.genai import types

from video_agent.config import GEMINI_API_KEY, GEMINI_BASE_URL, GEMINI_MODEL
from video_agent.prompts import SYSTEM_PROMPT_TEMPLATE
from video_agent.tools import TOOL_FUNCTIONS, TOOLS


# ANSI colors for terminal output
class _C:
    CYAN = "\033[36m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    DIM = "\033[2m"
    BOLD = "\033[1m"
    RESET = "\033[0m"


class Agent:
    """Stateful ReAct agent. Keeps conversation history across multiple .run() calls."""

    def __init__(self, workspace_dir: str):
        self.workspace_dir = workspace_dir
        http_options = {"api_version": "v1beta"}
        if GEMINI_BASE_URL:
            http_options["base_url"] = GEMINI_BASE_URL
        self.client = genai.Client(
            api_key=GEMINI_API_KEY,
            http_options=http_options,
        )
        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(workspace_dir=workspace_dir)
        self.config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            tools=TOOL_FUNCTIONS,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(
                disable=True,
            ),
            temperature=0.7,
        )
        self.contents: list[types.Content] = []

    def run(self, user_message: str, max_turns: int = 30):
        """Send a user message and let the agent work until it stops or hits the limit."""
        self.contents.append(
            types.Content(
                role="user",
                parts=[types.Part.from_text(text=user_message)],
            )
        )

        for turn in range(max_turns):
            print(f"\n{_C.DIM}--- turn {turn + 1} ---{_C.RESET}")

            try:
                response = self.client.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=self.contents,
                    config=self.config,
                )
            except Exception as e:
                print(f"\n{_C.YELLOW}[Error]: {e}{_C.RESET}")
                break

            self.contents.append(response.candidates[0].content)

            # Print agent text (thinking / final answer)
            # Access parts directly to avoid SDK warning when response has both text and function_call parts
            parts = response.candidates[0].content.parts if response.candidates else []
            agent_text = "".join(p.text for p in parts if hasattr(p, "text") and p.text)
            if agent_text:
                print(f"\n{_C.CYAN}{_C.BOLD}[Agent]{_C.RESET} {agent_text}")

            # No tool calls → agent finished this round
            function_calls = response.function_calls
            if not function_calls:
                break

            # Execute tool calls and collect results
            function_response_parts = []
            for fc in function_calls:
                tool_name = fc.name
                tool_args = dict(fc.args) if fc.args else {}

                print(f"\n{_C.GREEN}[Tool] {tool_name}{_C.RESET}{_C.DIM}({_fmt_args(tool_args)}){_C.RESET}")

                func = TOOLS.get(tool_name)
                if func is None:
                    result = f"ERROR: Unknown tool '{tool_name}'"
                else:
                    try:
                        result = func(**tool_args)
                    except Exception as e:
                        result = f"ERROR: {type(e).__name__}: {e}"

                _print_result(result)

                function_response_parts.append(
                    types.Part.from_function_response(
                        name=tool_name,
                        response={"result": result},
                    )
                )

            self.contents.append(
                types.Content(role="user", parts=function_response_parts)
            )

        else:
            print(f"\n{_C.YELLOW}[Agent] 达到最大轮次限制 ({max_turns}){_C.RESET}")


def _fmt_args(args: dict) -> str:
    """Format tool args for display, truncating long values."""
    parts = []
    for k, v in args.items():
        s = str(v)
        if len(s) > 80:
            s = s[:77] + "..."
        parts.append(f"{k}={s}")
    return ", ".join(parts)


def _print_result(result: str):
    """Print a tool result, truncated for readability."""
    lines = result.splitlines()
    if len(lines) > 15:
        preview = "\n".join(lines[:12])
        print(f"{_C.DIM}[Result] {preview}\n  ... ({len(lines)} lines total){_C.RESET}")
    elif len(result) > 500:
        print(f"{_C.DIM}[Result] {result[:500]}...{_C.RESET}")
    else:
        print(f"{_C.DIM}[Result] {result}{_C.RESET}")
