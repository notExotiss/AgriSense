import * as React from "react"
import { cn } from "./utils"

export function Dialog({ children }: { children: React.ReactNode }){ return <div>{children}</div> }
export function DialogTrigger({ asChild, children }: any){ return asChild ? children : <button>{children}</button> }
export function DialogContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>){ return <div className={cn("fixed inset-0 z-50 flex items-center justify-center p-4", className)} {...props} /> }
export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>){ return <div className={cn("flex flex-col space-y-1.5", className)} {...props} /> }
export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>){ return <h3 className={cn("text-lg font-semibold", className)} {...props} /> }
export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>){ return <p className={cn("text-sm text-muted-foreground", className)} {...props} /> } 