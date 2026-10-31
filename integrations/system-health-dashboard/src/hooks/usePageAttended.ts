import { useEffect, useState } from 'react'
import { isPageAttended, onPageAttendedChange } from '@/lib/attention'

/** True while the page is visible and someone has used it recently (lib/attention.ts). */
export function usePageAttended(): boolean {
  const [attended, setAttended] = useState(isPageAttended)
  useEffect(() => {
    setAttended(isPageAttended())
    return onPageAttendedChange(setAttended)
  }, [])
  return attended
}
