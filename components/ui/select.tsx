import * as React from "react"
import { cn } from "./utils"

export function Select({ children }: { children: React.ReactNode }){ return <div>{children}</div> }
export function SelectTrigger({ className, ...props }: React.HTMLAttributes<HTMLDivElement>){ return <div className={cn("h-9 w-full rounded-md border bg-background px-3 py-1 text-sm flex items-center justify-between", className)} {...props} /> }
export function SelectValue({ placeholder }: { placeholder?: string }){ return <span className="text-muted-foreground">{placeholder}</span> }
export function SelectContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>){ return <div className={cn("mt-1 rounded-md border bg-popover p-1", className)} {...props} /> }
export function SelectItem({ value, children, className, ...props }: any){ return <div data-value={value} className={cn("px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm", className)} {...props}>{children}</div> } 