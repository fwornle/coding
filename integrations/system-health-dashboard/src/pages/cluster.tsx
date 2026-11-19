/**
 * The Cluster tab: the on-prem cluster's nodes, their jobs and the routing history beside
 * them — glass's Cluster page, the same component, so both dashboards show one cluster the
 * same way. Its /api/cluster and /api/routing are forwarded by server.js to the host's
 * obs-api (lib/cluster/cluster-routes.mjs), which reads ~/.glass/cluster.json and its keys.
 */
export { ClusterPage } from '../../glass-ui/cluster'
