// glass-ui/store.ts — stands in for '@/store' in the glass build (vite.config.ts
// aliases it). The reused components only need the typed hooks; coding's store
// module would pull in every slice (ukb, workflow, health …) and their imports.
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux'
import type { RootState, AppDispatch } from '@/store'

export type { RootState, AppDispatch }
export const useAppDispatch: () => AppDispatch = useDispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
