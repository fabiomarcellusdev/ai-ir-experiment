// quiet-hours-guard.mjs: a Claude Code PreToolUse hook for every tool (matcher "*"), in the main session and in
// subagents. Inside the owner's quiet hours (tools/quiet-hours.mjs, .local/quiet-hours.json), it asks the owner to
// approve each tool call. Outside them, or with no quiet hours set, it stays silent. Decision record: 0004.
//
// It fails closed: if the module cannot load or the check throws, it asks. The hook entry in .claude/settings.json
// also sets onFailure "block", so a crash, a timeout or a missing node blocks the call.

const ask = (reason) => process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: `quiet-hours-guard: ${reason}` },
}));

try {
  for await (const _ of process.stdin); // the tool call itself does not matter: every call is held
  const { status } = await import("../../tools/quiet-hours.mjs");
  const s = status();
  if (s.quiet) ask(`${s.reason}. No work without the owner's approval for each action.`);
} catch (e) {
  ask(`could not decide (${e.message}); the owner decides.`);
}
