#!/usr/bin/env node
// bin/glass.mjs — entry point. `glass daemon` sets the measurement environment
// before importing anything that reads it; every other command is lib/glass/cli.mjs.
import { glassHome, glassPort, daemonEnv } from '../lib/glass/home.mjs';

const argv = process.argv.slice(2);

if (argv[0] === 'daemon') {
  const home = glassHome();
  Object.assign(process.env, daemonEnv(home));
  const { startDaemon } = await import('../lib/glass/daemon.mjs');
  const idleMin = Number(process.env.GLASS_IDLE_MIN) || 30;
  const retentionDays = Number(process.env.GLASS_RETENTION_DAYS) || 7;
  try {
    const d = await startDaemon({ home, port: glassPort(), idleMs: idleMin * 60_000, retentionDays });
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => d.close());
    await d.closed;
    process.exit(0);
  } catch (err) {
    process.stderr.write(`glass daemon: ${err.code === 'EADDRINUSE' ? `port ${glassPort()} is in use` : err.stack || err}\n`);
    process.exit(1);
  }
} else {
  const { main } = await import('../lib/glass/cli.mjs');
  process.exitCode = await main(argv);
}
