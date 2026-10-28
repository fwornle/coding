/**
 * Harness text that reaches the LSL as a "user" message but is nobody's job:
 * notifications, slash-command and skill expansions, bash-mode commands and
 * their output. The measurement drops it from the corpus; `propose` drops it
 * from the gaps, so a reference set built before a pattern was added is
 * cleaned too.
 */
const HARNESS_NOISE = [
  /^<task-notification>/, /^<local-command-/, /^<command-(name|message)>/, /^Caveat:/,
  /^This session is being continued from a previous conversation/,
  /^# /,                                    // a slash command's expanded skill file
  /^\[Request interrupted/,
  /^Base directory for this skill:/,        // a skill loaded by the model
  /^\(Re-invocation of \//,                 // a skill invoked again
  /^Skill \/\S+ is already loaded/,
  /^! /,                                    // bash mode: the command the user ran
  /^<bash-(input|stdout|stderr)>/,          // ... and its output
  /^The following tool was executed by the user/,
];

export function isHarnessNoise(text) {
  const t = String(text || '').trimStart();
  return HARNESS_NOISE.some((re) => re.test(t));
}
