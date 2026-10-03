'use strict';

/**
 * Which feature owns each slash command in .claude/commands/.
 *
 * A skill is a feature's entry point into an agent session exactly like a hook
 * is, so a disabled feature must not ship one: `/constraints` on an install
 * without the constraint monitor, or `/semantic` without a knowledge base,
 * only offers the agent a command that fails.
 *
 * `null` = base: useful on every tier.
 *
 * Read by the two places that hand skills to an agent — the per-launch plugin
 * (scripts/build-claude-runtime-config.mjs) and the global copy
 * (scripts/generate-agent-instructions.sh). The generated skill CATALOGS
 * (CLAUDE.md, .github/copilot-instructions.md) are tracked files describing the
 * repo, so they stay complete. tests/features/skill-gating.test.mjs fails when a
 * skill exists without an entry here.
 */
const SKILL_FEATURES = {
  constraints: 'constraints',
  'documentation-style': null,
  experiment: 'performance',
  graphify: 'codegraph',
  kgbench: 'performance',
  'playwright-cli': null,
  semantic: 'knowledge',
  sl: 'lsl',
};

/**
 * Whether a skill should be installed. An unknown skill counts as base: the
 * test above keeps the map complete, and failing open here means a new skill
 * is visible rather than silently missing.
 *
 * @param {string} name  skill file name without `.md`
 * @param {(feature: string) => boolean} isEnabled
 */
function skillEnabled(name, isEnabled) {
  const feature = SKILL_FEATURES[name];
  return feature == null || isEnabled(feature);
}

module.exports = { SKILL_FEATURES, skillEnabled };
