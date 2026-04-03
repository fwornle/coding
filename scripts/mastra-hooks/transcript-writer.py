#!/usr/bin/env python3
"""Mastra lifecycle hook → NDJSON transcript writer.
Reads JSON from stdin (mastracode hook protocol), writes one NDJSON line to transcript file.
"""
import sys, json, os, datetime

def main():
    try:
        d = json.load(sys.stdin)
    except Exception:
        return  # silently skip if stdin is not valid JSON

    event = d.get("hook_event_name", os.environ.get("MASTRA_HOOK_EVENT", ""))
    ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    sid = d.get("session_id", "")
    cwd = d.get("cwd", "")

    if event == "SessionStart":
        out = {"type": "session_start", "sessionId": sid, "cwd": cwd, "timestamp": ts}
    elif event == "SessionEnd":
        out = {"type": "session_end", "sessionId": sid, "cwd": cwd, "timestamp": ts}
    elif event == "UserPromptSubmit":
        out = {"type": "message", "role": "user", "content": d.get("user_message", ""),
               "sessionId": sid, "cwd": cwd, "timestamp": ts}
    elif event == "Stop":
        out = {"type": "message", "role": "assistant", "content": d.get("assistant_message", ""),
               "reason": d.get("stop_reason", ""), "sessionId": sid, "cwd": cwd, "timestamp": ts}
    elif event == "PreToolUse":
        out = {"type": "onToolCall", "tool": d.get("tool_name", ""),
               "input": d.get("tool_input", ""), "sessionId": sid, "cwd": cwd, "timestamp": ts}
    elif event == "PostToolUse":
        out = {"type": "onToolResult", "tool": d.get("tool_name", ""),
               "output": d.get("tool_output", ""), "sessionId": sid, "cwd": cwd, "timestamp": ts}
    else:
        out = {"type": event, "sessionId": sid, "cwd": cwd, "timestamp": ts, "raw": d}

    transcript = os.environ.get("MASTRA_TRANSCRIPT_FILE", "")
    if transcript:
        with open(transcript, "a") as f:
            f.write(json.dumps(out, ensure_ascii=False) + "\n")
    else:
        print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()
