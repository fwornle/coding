import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface HealingAttempt {
  action: string
  timestamp: string
  success: boolean
  message: string
  issueDetails?: any
}

interface AutoHealingState {
  enabled: boolean
  recentAttempts: HealingAttempt[]
  triggeringVerification: boolean
  lastTriggerTime: string | null
  error: string | null
}

const initialState: AutoHealingState = {
  enabled: true,
  recentAttempts: [],
  triggeringVerification: false,
  lastTriggerTime: null,
  error: null,
}

const autoHealingSlice = createSlice({
  name: 'autoHealing',
  initialState,
  reducers: {
    setAutoHealingEnabled(state, action: PayloadAction<boolean>) {
      state.enabled = action.payload
    },
    addHealingAttempt(state, action: PayloadAction<HealingAttempt>) {
      state.recentAttempts.unshift(action.payload)
      // Keep only last 20 attempts
      if (state.recentAttempts.length > 20) {
        state.recentAttempts = state.recentAttempts.slice(0, 20)
      }
    },
    triggerVerificationStart(state) {
      state.triggeringVerification = true
      state.error = null
    },
    triggerVerificationSuccess(state) {
      state.triggeringVerification = false
      state.lastTriggerTime = new Date().toISOString()
      state.error = null
    },
    triggerVerificationFailure(state, action: PayloadAction<string>) {
      state.triggeringVerification = false
      state.error = action.payload
    },
  },
})

export const {
  setAutoHealingEnabled,
  addHealingAttempt,
  triggerVerificationStart,
  triggerVerificationSuccess,
  triggerVerificationFailure,
} = autoHealingSlice.actions

export default autoHealingSlice.reducer
