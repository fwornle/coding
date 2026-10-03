import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import type { RootState } from '../index'

/**
 * Teams configuration — a team is a set of repos (lib/teams/config.cjs).
 *
 * Read and written through the health coordinator (`/api/teams-config` is
 * reverse-proxied by server.js), because ~/.coding/teams.yaml and the repos
 * discovery walks are on the host. Not `/api/teams`: obs-api serves the
 * viewer's registry under that name.
 */

export interface RepoRef { path?: string; remote?: string; id?: string }

export interface TeamEntry {
  id: string
  label: string
  kind: 'team' | 'project'
  description: string
  repos: RepoRef[]
  include: string[]
  /** Which layers contributed — `~/.coding/teams.yaml` means the user can delete it. */
  sources: string[]
  active: boolean
  /** Host paths of the discovered repos that belong to this team. */
  members: string[]
}

export interface DiscoveredRepo {
  path: string
  name: string
  markers: string[]
  learningRepo: boolean
  learningRemote: string
  outerRemote: string
  teams: string[]
  projectId: string
}

export interface SharedItem {
  team: string
  remote: string
  path: string
  state: 'local' | 'shared' | 'missing'
}

interface TeamsConfigState {
  loaded: boolean
  loading: boolean
  saving: boolean
  error: string | null
  teams: TeamEntry[]
  active: string[]
  activeSource: string
  discovery: { roots: string[]; depth: number; scannedAt?: string } | null
  repos: DiscoveredRepo[]
  shared: SharedItem[]
  warnings: string[]
  lastSyncLog: string[]
}

const initialState: TeamsConfigState = {
  loaded: false,
  loading: false,
  saving: false,
  error: null,
  teams: [],
  active: [],
  activeSource: '',
  discovery: null,
  repos: [],
  shared: [],
  warnings: [],
  lastSyncLog: [],
}

async function readJson(res: Response) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

export const fetchTeamsConfig = createAsyncThunk('teamsConfig/fetch', async () =>
  readJson(await fetch('/api/teams-config')))

export const saveTeamsConfig = createAsyncThunk(
  'teamsConfig/save',
  async (patch: { active?: string[] | null; teams?: Record<string, Partial<Omit<TeamEntry, 'id'>> | null> }) =>
    readJson(await fetch('/api/teams-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })),
)

export const rescanRepos = createAsyncThunk('teamsConfig/discover', async () =>
  readJson(await fetch('/api/teams-config/discover', { method: 'POST' })))

export const syncSharedRepos = createAsyncThunk('teamsConfig/sync', async () =>
  readJson(await fetch('/api/teams-config/sync', { method: 'POST' })))

const teamsConfigSlice = createSlice({
  name: 'teamsConfig',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    const absorb = (state: TeamsConfigState, p: any) => {
      state.teams = p.teams ?? []
      state.active = p.active ?? []
      state.activeSource = p.activeSource ?? ''
      state.discovery = p.discovery ?? null
      state.repos = p.repos ?? []
      state.shared = p.shared ?? []
      state.warnings = p.warnings ?? []
      if (p.synced) state.lastSyncLog = p.synced.log ?? []
      state.loaded = true
      state.error = null
    }
    builder
      .addCase(fetchTeamsConfig.pending, (s) => { s.loading = true })
      .addCase(fetchTeamsConfig.fulfilled, (s, a) => { s.loading = false; absorb(s, a.payload) })
      .addCase(fetchTeamsConfig.rejected, (s, a) => { s.loading = false; s.error = a.error.message ?? 'could not read teams' })
    for (const thunk of [saveTeamsConfig, rescanRepos, syncSharedRepos]) {
      builder
        .addCase(thunk.pending, (s) => { s.saving = true; s.error = null })
        .addCase(thunk.fulfilled, (s, a) => { s.saving = false; absorb(s, a.payload) })
        .addCase(thunk.rejected, (s, a) => { s.saving = false; s.error = a.error.message ?? 'request failed' })
    }
  },
})

export default teamsConfigSlice.reducer

export const selectTeamsConfig = (s: RootState) => s.teamsConfig
