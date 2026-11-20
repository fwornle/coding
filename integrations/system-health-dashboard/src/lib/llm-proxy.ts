/**
 * Where the dashboard reaches rapid-llm-proxy: its admin and telemetry API on the
 * loopback interface. Its write endpoints accept loopback callers only, which this
 * origin is.
 */
export const PROXY_PORT = '12435'
export const PROXY_BASE = `http://localhost:${PROXY_PORT}`
