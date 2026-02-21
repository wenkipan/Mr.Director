"""VideoAgent CLI — natural language interactive interface."""
import os
import sys

from video_agent.agent import Agent
from video_agent.workspace import init_workspace


BANNER = """\
╔══════════════════════════════════════════════╗
║           Video Agent  v0.1                  ║
║        LLM as Director                       ║
║                                              ║
║  直接用自然语言告诉我你想做什么               ║
║  输入 /quit 退出                              ║
╚══════════════════════════════════════════════╝
"""


def main():
    # Optional: workspace dir from argv or env or cwd
    if len(sys.argv) >= 2 and not sys.argv[1].startswith("-"):
        workspace_dir = os.path.abspath(sys.argv[1])
    else:
        workspace_dir = None

    workspace_dir = init_workspace(workspace_dir)
    agent = Agent(workspace_dir)

    print(BANNER)
    print(f"  工作目录: {workspace_dir}\n")

    while True:
        try:
            user_input = input(">>> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见！")
            break

        if not user_input:
            continue
        if user_input in ("/quit", "/exit", "/q"):
            print("再见！")
            break

        agent.run(user_input)
        print()


if __name__ == "__main__":
    main()
