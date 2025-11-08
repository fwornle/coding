/**
 * Dashboard Configuration
 * Port configuration that reads from centralized .env.ports file
 *
 * Environment variables from ../../.env.ports:
 * - CONSTRAINT_DASHBOARD_PORT=3030
 * - CONSTRAINT_API_PORT=3031
 */

// Read port configuration from environment variables (from .env.ports)
const DASHBOARD_PORT = process.env.CONSTRAINT_DASHBOARD_PORT ? parseInt(process.env.CONSTRAINT_DASHBOARD_PORT) : 3030;
const API_PORT = process.env.CONSTRAINT_API_PORT ? parseInt(process.env.CONSTRAINT_API_PORT) : 3031;

export const CONFIG = {
  API_BASE_URL: `http://localhost:${API_PORT}`,
  DASHBOARD_PORT,
  API_PORT,
} as const;

export default CONFIG;