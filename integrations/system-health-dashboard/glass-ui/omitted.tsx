// glass's stand-in for the Token Usage parts it never renders (aliased in
// vite.config.ts): coding's LLM Routing dialog, Routing tab and Cost tab. They
// read coding's proxy routing API, which glass's daemon does not serve, and they
// carry coding's own routing setup in their text — glass builds without them.
// glass's own routing settings are glass-ui/offload.tsx.

export const TokenUsageSettingsDialog = () => null
export const TokenUsageRoutingTab = () => null
export const CostTab = () => null
