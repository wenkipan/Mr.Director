def ask_user(message: str) -> str:
    """Show information to the user and get their feedback via CLI.

    Args:
        message: The message to display to the user (supports markdown).

    Returns:
        The user's response text.
    """
    print("\n" + "=" * 60)
    print("VIDEO AGENT")
    print("=" * 60)
    print(message)
    print("-" * 60)
    response = input("请回复（直接回车表示确认）: ").strip()
    if not response:
        response = "OK，方案没问题，请继续执行。"
    return response
