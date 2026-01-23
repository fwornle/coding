#!/usr/bin/env node
/**
 * Simple static file server for the health dashboard frontend in Docker mode.
 * Serves the pre-built Vite app from the dist/ directory.
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = parseInt(process.env.HEALTH_DASHBOARD_PORT || '3032', 10);

const app = express();
app.use(express.static(distDir));
app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));

app.listen(port, () => {
  console.log(`Health dashboard frontend serving from ${distDir} on port ${port}`);
});
