import * as React from "react"

import { cn } from "@/lib/utils"

// shadcn-v3 Skeleton primitive. Single <div> with pulsing background —
// used by StatsBar loading state per UI-SPEC §16 row 1.

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-accent animate-pulse rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
