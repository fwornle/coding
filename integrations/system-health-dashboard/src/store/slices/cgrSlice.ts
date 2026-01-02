import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export type CGRStatus = 'fresh' | 'stale' | 'diverged' | 'no_cache' | 'unknown'
export type ReindexStatus = 'idle' | 'confirming' | 'running' | 'completed' | 'failed'

interface CGRState {
  cacheStatus: CGRStatus
  commitsBehind: number | null
  cachedCommit: string | null
  currentCommit: string | null
  lastChecked: string | null
  reindexStatus: ReindexStatus
  reindexStartTime: string | null
  reindexError: string | null
  showConfirmModal: boolean
}

const initialState: CGRState = {
  cacheStatus: 'unknown',
  commitsBehind: null,
  cachedCommit: null,
  currentCommit: null,
  lastChecked: null,
  reindexStatus: 'idle',
  reindexStartTime: null,
  reindexError: null,
  showConfirmModal: false,
}

const cgrSlice = createSlice({
  name: 'cgr',
  initialState,
  reducers: {
    updateCacheStatus(state, action: PayloadAction<{
      status: CGRStatus
      commitsBehind?: number
      cachedCommit?: string
      currentCommit?: string
    }>) {
      state.cacheStatus = action.payload.status
      state.commitsBehind = action.payload.commitsBehind ?? null
      state.cachedCommit = action.payload.cachedCommit ?? null
      state.currentCommit = action.payload.currentCommit ?? null
      state.lastChecked = new Date().toISOString()
    },
    openConfirmModal(state) {
      state.showConfirmModal = true
    },
    closeConfirmModal(state) {
      state.showConfirmModal = false
    },
    reindexStart(state) {
      state.reindexStatus = 'running'
      state.reindexStartTime = new Date().toISOString()
      state.reindexError = null
      state.showConfirmModal = false
    },
    reindexSuccess(state) {
      state.reindexStatus = 'completed'
      state.cacheStatus = 'fresh'
      state.commitsBehind = 0
    },
    reindexFailure(state, action: PayloadAction<string>) {
      state.reindexStatus = 'failed'
      state.reindexError = action.payload
    },
    reindexReset(state) {
      state.reindexStatus = 'idle'
      state.reindexError = null
      state.reindexStartTime = null
    },
  },
})

export const {
  updateCacheStatus,
  openConfirmModal,
  closeConfirmModal,
  reindexStart,
  reindexSuccess,
  reindexFailure,
  reindexReset,
} = cgrSlice.actions

export default cgrSlice.reducer
