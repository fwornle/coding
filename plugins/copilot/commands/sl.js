import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const commandPath = fileURLToPath(new URL('../../../.claude/commands/sl.md', import.meta.url));

/** Expose the canonical session-log workflow as Copilot's native /sl command. */
export async function sl(args) {
  const workflow = await readFile(commandPath, 'utf8');
  const argumentText = typeof args === 'string' ? args : args?.count ?? '';
  return {
    status: 'success',
    output: `${workflow}\n\nUser arguments: ${argumentText || '(none)'}`,
    handled: true,
  };
}
