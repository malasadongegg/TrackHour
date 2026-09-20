# claude-code-hook/

Not built yet (phase 3).

A Claude Code hook that reports sessions and lines changed to Supabase. Its sessions are `source: "code_hook"` with `confidence: "measured"`, tool key `claude_code`, and carry `linesChanged`. It reports numbers only, never code or prompts.

It will reuse `@trackhour/core` types.
