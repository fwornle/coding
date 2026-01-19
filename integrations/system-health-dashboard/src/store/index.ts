import { configureStore, combineReducers } from '@reduxjs/toolkit'
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux'

// Import slices
import healthStatusReducer from './slices/healthStatusSlice'
import healthReportReducer from './slices/healthReportSlice'
import autoHealingReducer from './slices/autoHealingSlice'
import apiQuotaReducer from './slices/apiQuotaSlice'
import ukbReducer from './slices/ukbSlice'
import cgrReducer from './slices/cgrSlice'
import workflowConfigReducer from './slices/workflowConfigSlice'

// Import middleware
import { healthRefreshMiddleware } from './middleware/healthRefreshMiddleware'
import { apiMiddleware } from './middleware/apiMiddleware'

const rootReducer = combineReducers({
  healthStatus: healthStatusReducer,
  healthReport: healthReportReducer,
  autoHealing: autoHealingReducer,
  apiQuota: apiQuotaReducer,
  ukb: ukbReducer,
  cgr: cgrReducer,
  workflowConfig: workflowConfigReducer,
})

export type RootState = ReturnType<typeof rootReducer>

export const store: any = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types
        ignoredActions: [
          'persist/PERSIST',
          'persist/REHYDRATE',
          'workflowConfig/initialize/fulfilled',
          'workflowConfig/initialize/rejected',
          'workflowConfig/useFallbackConfig',
        ],
        // Ignore these field paths in all actions
        ignoredActionsPaths: ['meta.arg', 'payload.timestamp', 'payload.orchestrator', 'payload.agents'],
        // Ignore these paths in the state
        // workflowConfig stores React components (LucideIcons) in orchestrator.icon and agents[].icon
        ignoredPaths: ['items.dates', 'workflowConfig.orchestrator', 'workflowConfig.agents'],
      },
    })
      .concat(healthRefreshMiddleware as any)
      .concat(apiMiddleware as any),
  devTools: process.env.NODE_ENV !== 'production',
})

export type AppDispatch = typeof store.dispatch

// Typed hooks for use throughout the app
export const useAppDispatch = () => useDispatch<AppDispatch>()
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
