import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import type { RootState } from '../index'

/**
 * Which parts of `coding` are switched on.
 *
 * The dashboard is one of nine surfaces that gate on this (see
 * docs/architecture/features.md); the others are the launcher, the service
 * starter, the container entrypoint, the agent hooks, the status line, the
 * coordinator's own checks, the daemon reconciler and the CLIs. The resolver
 * lives on the host — /api/features is a reverse-proxy to the health
 * coordinator, because this server runs inside the container and the file being
 * edited is ~/.coding/features.yaml on the host.
 *
 * FAILS OPEN. If the coordinator is unreachable we show everything rather than
 * hiding tabs: a dashboard that silently loses half its navigation because a
 * host service blipped looks exactly like a broken build, and the user has no
 * way to tell the difference. The reverse — briefly offering a tab for a
 * feature that is off — costs an empty panel and an honest error.
 */

export type FeatureId =
  | 'lsl' | 'observations' | 'knowledge' | 'codegraph' | 'constraints'
  | 'llm-proxy' | 'performance' | 'health' | 'statusline'

export interface FeatureState {
  enabled: boolean
  /** Human-readable "why", straight from the resolver. Shown in tooltips. */
  reason: string
  /** Which layer decided: default | config/features.yaml | ~/.coding/... | env | dependency */
  source: string
  label: string
  description: string
  requires: FeatureId[]
  applyTier: 'live' | 'apply' | 'session'
  needsDocker: boolean
}

interface FeaturesSliceState {
  loading: boolean
  saving: boolean
  applying: boolean
  /** Never blocks rendering — see FAILS OPEN above. */
  error: string | null
  loaded: boolean
  profile: string | null
  features: Record<string, FeatureState>
  enabled: FeatureId[]
  disabled: FeatureId[]
  needsDocker: boolean
  warnings: string[]
  /** profile name -> the feature ids it switches on */
  profiles: Record<string, FeatureId[]>
  /** Set after a save whose apply tier includes 'session'. */
  restartNotice: string | null
}

const initialState: FeaturesSliceState = {
  loading: false,
  saving: false,
  applying: false,
  error: null,
  loaded: false,
  profile: null,
  features: {},
  enabled: [],
  disabled: [],
  needsDocker: true,
  warnings: [],
  profiles: {},
  restartNotice: null,
}

async function readJson(res: Response) {
  const body = await res.json().catch(() => ({}))
  if (body?.ok === false) throw new Error(body.error || 'feature configuration unavailable')
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
  return body
}

export const fetchFeatures = createAsyncThunk('features/fetch', async () => {
  return readJson(await fetch('/api/features'))
})

export const saveFeatures = createAsyncThunk(
  'features/save',
  async (payload: { features?: Record<string, boolean>; profile?: string }) => {
    const saved = await readJson(await fetch('/api/features', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }))
    // Saving and applying are one user action, so they are one thunk: a change
    // that is recorded but not applied leaves the dashboard truthful and the
    // machine wrong, which is the worst of both.
    const applied = await readJson(await fetch('/api/features/apply', { method: 'POST' }))
    return { saved, applied }
  },
)

const featuresSlice = createSlice({
  name: 'features',
  initialState,
  reducers: {
    dismissRestartNotice(state) {
      state.restartNotice = null
    },
  },
  extraReducers: (builder) => {
    const absorb = (state: FeaturesSliceState, payload: any) => {
      state.profile = payload.profile ?? null
      state.features = payload.features ?? {}
      state.enabled = payload.enabled ?? []
      state.disabled = payload.disabled ?? []
      state.needsDocker = payload.needsDocker ?? true
      state.warnings = payload.warnings ?? []
      if (payload.profiles) state.profiles = payload.profiles
      state.loaded = true
      state.error = null
    }

    builder
      .addCase(fetchFeatures.pending, (state) => { state.loading = true })
      .addCase(fetchFeatures.fulfilled, (state, action) => {
        state.loading = false
        absorb(state, action.payload)
      })
      .addCase(fetchFeatures.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message ?? 'could not read feature configuration'
        // Deliberately NOT clearing `features`: a transient failure must not
        // collapse the navigation of a dashboard that was working a second ago.
      })
      .addCase(saveFeatures.pending, (state) => { state.saving = true; state.error = null })
      .addCase(saveFeatures.fulfilled, (state, action) => {
        state.saving = false
        absorb(state, action.payload.saved)
        const sessionScoped = Object.entries(state.features)
          .filter(([, f]) => f.applyTier === 'session')
          .map(([id]) => id)
        state.restartNotice = sessionScoped.length
          ? `${sessionScoped.join(', ')} affect agent hooks — start a new session to pick that up.`
          : null
      })
      .addCase(saveFeatures.rejected, (state, action) => {
        state.saving = false
        state.error = action.error.message ?? 'could not save feature configuration'
      })
  },
})

export const { dismissRestartNotice } = featuresSlice.actions
export default featuresSlice.reducer

// ── selectors ────────────────────────────────────────────────────────────────

export const selectFeatures = (s: RootState) => s.features

/**
 * Is a feature on? Unknown ids and an unloaded store both answer `true` — see
 * FAILS OPEN. Callers that need to distinguish "on" from "not known yet" should
 * read `loaded`.
 */
export const selectFeatureEnabled = (id: FeatureId) => (s: RootState): boolean => {
  const f = s.features.features[id]
  return f ? f.enabled : true
}

/** The resolver's reason string, for a tooltip on a greyed tile. */
export const selectFeatureReason = (id: FeatureId) => (s: RootState): string =>
  s.features.features[id]?.reason ?? ''

export const selectFeature = (id: FeatureId) => (s: RootState): FeatureState | undefined =>
  s.features.features[id]
