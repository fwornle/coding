import { lazy, Suspense, useMemo, useState, type ComponentProps } from 'react'
import { ClusterPage as SharedClusterPage } from '../../glass-ui/cluster'
import { OffloadContext } from '../../glass-ui/offload'
import { PROXY_BASE } from '@/lib/llm-proxy'

const TokenUsageSettingsDialog = lazy(() =>
  import('./token-usage-settings-dialog').then((m) => ({ default: m.TokenUsageSettingsDialog })))

type OffloadCtx = ComponentProps<typeof OffloadContext.Provider>['value']

/**
 * The Cluster tab: the on-prem cluster's nodes, their jobs and the routing history beside
 * them — glass's Cluster page, the same component, so both dashboards show one cluster the
 * same way. Its /api/cluster and /api/routing are forwarded by server.js to the host's
 * obs-api (lib/cluster/cluster-routes.mjs), which reads ~/.glass/cluster.json and its keys.
 *
 * The page's offload settings are coding's, not glass's: here the offload is the proxy's
 * semantic offload to the cluster (`qwen-local`), configured in the LLM Routing dialog —
 * so "Offload settings" opens that dialog, whose Endpoint section holds the cluster URL
 * and CLUSTER_OPS_KEY. There is no glass daemon here, so there is no glass offload view.
 */
export function ClusterPage() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const ctx = useMemo<OffloadCtx>(() => ({
    view: null,
    error: '',
    openSettings: () => setSettingsOpen(true),
    patch: async () => { throw new Error('offload is configured in the LLM Routing dialog') },
    isTarget: () => false,
  }), [])

  return (
    <OffloadContext.Provider value={ctx}>
      <SharedClusterPage />
      {settingsOpen && (
        <Suspense fallback={null}>
          <TokenUsageSettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            proxyBase={PROXY_BASE}
            hours={24}
          />
        </Suspense>
      )}
    </OffloadContext.Provider>
  )
}
