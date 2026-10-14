/**
 * tests/live-logging/etm-artifact-sources.test.js
 *
 * The artifact sources the extractor used to miss (2026-10-14): files written by
 * a Python / node heredoc, apply_patch envelopes (opencode, copilot), copilot's
 * `create`, sub-agent transcripts, and pi tool calls. Each case is a shape taken
 * from a real transcript; each "invents nothing" case is one that must stay
 * "none".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import EnhancedTranscriptMonitor, {
  bashWriteTargets, scriptWriteTargets, patchTargets, extractFileChanges, subagentFileChanges, relativizeArtifact,
} from '../../scripts/enhanced-transcript-monitor.js';

const bash = (command) => ({ name: 'Bash', input: { command } });
const files = (...toolCalls) => extractFileChanges([{ toolCalls }]).modifiedFiles;

test('python heredoc: a path bound to a name, then open(p, "w")', () => {
  const cmd = `cd /repo; python3 - <<'PYEOF'
p='scripts/health-coordinator.js'
s=open(p).read()
s=s.replace("a > b", "c")
open(p,'w').write(s)
PYEOF
node --check scripts/health-coordinator.js && echo ok`;
  assert.deepEqual(bashWriteTargets(cmd), ['/repo/scripts/health-coordinator.js'], 'the leading cd is the working directory');
});

test('python heredoc: a dict of edits looped with .items()', () => {
  const cmd = `python3 - <<'EOF'
edits = {
'docs/puml/a.puml': [
 ('x', 'y'),
],
'glass/overlay/docs/b.md': [
 ('"quoted": value', 'z'),
],
}
for p, reps in edits.items():
    s = open(p).read()
    open(p, 'w').write(s)
EOF`;
  assert.deepEqual(bashWriteTargets(cmd), ['docs/puml/a.puml', 'glass/overlay/docs/b.md']);
});

test('python: `p=...; s=open(p).read()` on one line', () => {
  assert.deepEqual(bashWriteTargets(`python3 - <<'EOF'\np='scripts/ensure-docker.sh'; s=open(p).read()\nassert a in s; s=s.replace(a,b); open(p,'w').write(s)\nEOF`), ['scripts/ensure-docker.sh']);
});

test('python: a helper rep(f, pairs) called with literal paths; a tuple list', () => {
  const cmd = `python3 - <<'EOF'
def rep(f, pairs):
    s=open(f).read()
    for a,b in pairs:
        assert s.count(a)==1,(f,a); s=s.replace(a,b)
    open(f,'w').write(s)
rep('scripts/enhanced-redaction-system.cjs',[("old.js", "new.js")])
rep('src/inference/SensitivityClassifier.js',[("a", "b")])
EOF`;
  assert.deepEqual(bashWriteTargets(cmd), ['scripts/enhanced-redaction-system.cjs', 'src/inference/SensitivityClassifier.js']);
  const tuples = `EDITS = [\n  ('lib/a.mjs', 'x.js', 'y.js'),\n  ('lib/b.mjs', 'p', 'q'),\n]\nfor p, old, new in EDITS:\n    open(p, 'w').write(new)`;
  assert.deepEqual(scriptWriteTargets(tuples), ['lib/a.mjs', 'lib/b.mjs'], 'replacement text that looks like a file is not taken');
});

test('python: literal open, Path.write_text, shutil.copy, a list loop', () => {
  assert.deepEqual(scriptWriteTargets(`open('a/b.json', "w").write(x)`), ['a/b.json']);
  assert.deepEqual(scriptWriteTargets(`Path('docs/c.md').write_text(t)`), ['docs/c.md']);
  assert.deepEqual(scriptWriteTargets(`f='bin/status'; s=open(f).read()\nopen(f,'w').write(s)`), ['bin/status'], 'an extensionless script');
  assert.deepEqual(scriptWriteTargets(`shutil.copy(src, 'docs/images/d.png')`), ['docs/images/d.png']);
  assert.deepEqual(scriptWriteTargets(`for f in ['x/1.py', 'x/2.py']:\n    open(f, 'a').write('\\n')`), ['x/1.py', 'x/2.py']);
});

test('node: writeFileSync with a literal or a bound const', () => {
  assert.deepEqual(scriptWriteTargets(`const f = 'lib/x.mjs';\nfs.writeFileSync(f, out)`, 'js'), ['lib/x.mjs']);
  assert.deepEqual(scriptWriteTargets(`fs.writeFileSync('config/y.json', JSON.stringify(c))`, 'js'), ['config/y.json']);
  assert.deepEqual(bashWriteTargets(`node -e 'require("fs").writeFileSync("out/z.json", "{}")'`), ['out/z.json']);
});

test('scripts: reads, computed paths and scratch writes are not artifacts', () => {
  assert.deepEqual(scriptWriteTargets(`s=open('a.py').read()\nprint(s)`), [], 'a read');
  assert.deepEqual(scriptWriteTargets(`open(f"{root}/x.py", 'w')`), [], 'an f-string');
  assert.deepEqual(scriptWriteTargets(`open(os.path.join(d, 'x.py'), 'w')`), [], 'a join');
  assert.deepEqual(scriptWriteTargets(`open(sys.argv[1], 'w')`), [], 'argv');
  assert.deepEqual(scriptWriteTargets(`p='/private/tmp/claude/scratchpad/pr.md'\nopen(p,'w').write(s)`), [], 'scratchpad');
  assert.deepEqual(scriptWriteTargets(`p='not a path'\nopen(p,'w')`), [], 'prose');
});

test('a leading cd is the working directory of relative targets', () => {
  assert.deepEqual(bashWriteTargets(`cd glass/overlay/docs/puml && echo x > glass-paths.txt`), ['glass/overlay/docs/puml/glass-paths.txt']);
  assert.deepEqual(bashWriteTargets(`cd /w/proxy; python3 - <<'E'\np='proxy-bridge/s.mjs'; open(p,'w').write(s)\nE`), ['/w/proxy/proxy-bridge/s.mjs']);
  assert.deepEqual(bashWriteTargets(`mkdir -p ~/p/shop && cd ~/p/shop && cat > cart.js <<'EOF'\nx\nEOF`), [`${process.env.HOME}/p/shop/cart.js`], 'one literal cd, not leading');
  assert.deepEqual(bashWriteTargets(`Q=/tmp/x; mkdir -p $Q/sandbox && cd $Q/sandbox && printf 'a' > harvest.csv`), [], 'cd into a variable: unknown');
  assert.deepEqual(bashWriteTargets(`cd a && echo 1 > x.txt && cd ../b && echo 2 > y.txt`), [], 'two cds: unknown');
  assert.deepEqual(bashWriteTargets(`cd x; echo a > /abs/out.json`), ['/abs/out.json'], 'an absolute target needs no cwd');
  assert.deepEqual(bashWriteTargets(`cd /w/ui && python3 - <<'PY'\np='models.tsx'; open(p,'w').write(s)\nPY\ncd .. && npx tsc`), ['/w/ui/models.tsx'], 'a cd after the script does not count');
});

test("sed with a `|` alternation in its script is not a path", () => {
  assert.deepEqual(bashWriteTargets(`for f in a.json b.js; do sed -i '' 's/GITHUB_TOKEN|GITLAB_TOKEN/GH_TOKEN|GITLAB_TOKEN/' $f; done`), []);
});

test('code inside a triple-quoted string or template literal is data, not the script', () => {
  const py = `p='tests/t.test.js'\nnew = """def rep(f, pairs):\n    open(f,'w').write(s)\nrep('scripts/fixture.cjs', [])\n"""\nopen(p,'w').write(new)`;
  assert.deepEqual(scriptWriteTargets(py), ['tests/t.test.js']);
  const js = "const body = `fs.writeFileSync('lib/in-template.mjs', x)`;\nfs.writeFileSync('out/real.mjs', body)";
  assert.deepEqual(scriptWriteTargets(js, 'js'), ['out/real.mjs']);
  // A backtick in Python is text: markdown in replacement strings must not hide the write.
  const md = "p='docs/x.md'; s=open(p).read()\ns=s.replace('`P:` x', '`K:NO` y')\nopen(p,'w').write(s)\nt='a `b` c'";
  assert.deepEqual(scriptWriteTargets(md), ['docs/x.md']);
});

test('a heredoc that is not a program is still not scanned (commit message)', () => {
  const cmd = `git commit -q -F - <<'EOF'
fix: write open('x.py','w') > out.txt in prose
EOF`;
  assert.deepEqual(bashWriteTargets(cmd), []);
});

test('apply_patch: opencode patchText and copilot raw string', () => {
  const patch = '*** Begin Patch\n*** Update File: /repo/src/a.ts\n@@\n-x\n+y\n*** Add File: src/b.ts\n+z\n*** Delete File: src/old.ts\n*** End Patch';
  assert.deepEqual(patchTargets(patch), ['/repo/src/a.ts', 'src/b.ts', 'src/old.ts']);
  assert.deepEqual(files({ name: 'apply_patch', input: { patchText: patch } }), ['/repo/src/a.ts', 'src/b.ts', 'src/old.ts']);
  assert.deepEqual(files({ name: 'apply_patch', arguments: patch }), ['/repo/src/a.ts', 'src/b.ts', 'src/old.ts']);
  assert.deepEqual(patchTargets('--- a/x.js\n+++ b/lib/x.js\n@@'), ['lib/x.js']);
});

test('copilot create / str_replace; Write into a scratchpad is no artifact', () => {
  assert.deepEqual(files({ name: 'create', input: { path: 'src/new.ts' } }), ['src/new.ts']);
  assert.deepEqual(files({ name: 'str_replace', input: { path: 'src/e.ts' } }), ['src/e.ts']);
  assert.deepEqual(files({ name: 'Write', input: { file_path: '/private/tmp/claude-502/x/scratchpad/t8_checklist.py' } }), []);
  assert.deepEqual(files({ name: 'create', input: { path: '/Users/u/.copilot/session-state/6dc6/plan.md' } }), [], "copilot's own session state");
});

test('sub-agents: files from the Agent result id and from a <task-id> notification', () => {
  const sub = (toolUses) => toolUses.map((b) => JSON.stringify({ type: 'assistant', message: { content: [b] } })).join('\n');
  const fsMap = {
    '/p/s1/subagents/agent-a1935b7ab11a36596.jsonl': sub([
      { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/repo/lib/x.mjs' } },
      { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/repo/lib/y.mjs' } },
    ]),
    '/p/s1/subagents/agent-bfeed00112233445.jsonl': sub([
      { type: 'tool_use', id: 't3', name: 'Bash', input: { command: "python3 - <<'P'\np='docs/z.md'\nopen(p,'w').write(s)\nP" } },
    ]),
  };
  const readFile = (f) => { if (f in fsMap) return fsMap[f]; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  const launched = {
    toolCalls: [{ name: 'Agent', id: 'call1', input: { prompt: 'do it' } }],
    toolResults: [{ tool_use_id: 'call1', content: [{ type: 'text', text: 'done.\nagentId: a1935b7ab11a36596 (use SendMessage …)' }] }],
  };
  const notified = { userMessage: '<task-notification>\n<task-id>bfeed00112233445</task-id>\n<status>completed</status>', toolCalls: [], toolResults: [] };
  const bgShell = { userMessage: '<task-id>bvr2c0i76</task-id>', toolCalls: [], toolResults: [] };
  const got = subagentFileChanges([launched, notified, bgShell], '/p/s1.jsonl', { readFile });
  assert.deepEqual(got.modifiedFiles, ['/repo/lib/x.mjs', 'docs/z.md']);
  assert.deepEqual(got.readFiles, ['/repo/lib/y.mjs']);
  assert.deepEqual(subagentFileChanges([launched], 'opencode://ses_1', { readFile }).modifiedFiles, [], 'not a Claude transcript');
});

test('_extractFileChanges: own + sub-agent files, repo-relative', () => {
  const proto = EnhancedTranscriptMonitor.prototype;
  const stub = { config: { projectPath: '/repo' }, transcriptPath: null };
  const got = proto._extractFileChanges.call(stub, [{ toolCalls: [
    { name: 'Write', input: { file_path: '/repo/src/a.ts' } },
    bash("python3 - <<'X'\nopen('src/a.ts','w').write(s)\nX"),
    { name: 'Edit', input: { file_path: '/elsewhere/b.ts' } },
  ] }]);
  assert.deepEqual(got.modifiedFiles, ['src/a.ts', '/elsewhere/b.ts'], 'one file listed once, however it was written');
  assert.equal(relativizeArtifact('/repo/../x', '/repo'), '/repo/../x');
});

test('pi: tool calls survive normalization and reach the extractor', () => {
  const proto = EnhancedTranscriptMonitor.prototype;
  const out = proto.normalizePiMessages.call({}, [
    { type: 'message', id: 'u1', timestamp: 't', message: { role: 'user', content: [{ type: 'text', text: 'fix it' }] } },
    { type: 'message', id: 'a1', timestamp: 't', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'c1', name: 'edit', arguments: { path: 'src/p.ts', oldText: 'a', newText: 'b' } },
    ] } },
    { type: 'message', id: 'a2', timestamp: 't', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
  ]);
  const toolUse = out.flatMap((m) => (Array.isArray(m.message.content) ? m.message.content : [])).find((b) => b.type === 'tool_use');
  assert.deepEqual(toolUse, { type: 'tool_use', id: 'c1', name: 'edit', input: { path: 'src/p.ts', oldText: 'a', newText: 'b' } });
  assert.deepEqual(files({ name: toolUse.name, input: toolUse.input }), ['src/p.ts']);
  assert.equal(out.find((m) => m.uuid === 'a2').message.content, 'done', 'text-only stays a string');
});
