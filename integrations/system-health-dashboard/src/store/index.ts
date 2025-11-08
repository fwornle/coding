import { configureStore, combineReducers } from '@reduxjs/toolkit'
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux'

// Import slices
import healthStatusReducer from './slices/healthStatusSlice'
import healthReportReducer from './slices/healthReportSlice'
import autoHealingReducer from './slices/autoHealingSlice'

// Import middleware
import { healthRefreshMiddleware } from './middleware/healthRefreshMiddleware'
import { apiMiddleware } from './middleware/apiMiddleware'

const rootReducer = combineReducers({
  healthStatus: healthStatusReducer,
  healthReport: healthReportReducer,
  autoHealing: autoHealingReducer,
})

export type RootState = ReturnType<typeof rootReducer>

export const store: any = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
        // Ignore these field paths in all actions
        ignoredActionsPaths: ['meta.arg', 'payload.timestamp'],
        // Ignore these paths in the state
        ignoredPaths: ['items.dates'],
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
