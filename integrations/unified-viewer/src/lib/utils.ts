// PATTERN SOURCE: integrations/system-health-dashboard/src/lib/utils.ts (verbatim port)
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
