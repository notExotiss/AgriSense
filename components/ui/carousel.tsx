import * as React from "react"
import { cn } from "./utils"

export function Carousel({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("relative", className)} {...props}>
      {children}
    </div>
  )
}

export function CarouselContent({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div 
      className={cn("flex overflow-x-auto scrollbar-hide scroll-smooth", className)} 
      {...props}
    >
      {children}
    </div>
  )
}

export function CarouselItem({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex-shrink-0", className)} {...props}>
      {children}
    </div>
  )
}

export function CarouselPrevious({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "absolute left-2 top-1/2 -translate-y-1/2 z-10 h-8 w-8 rounded-full bg-background/80 border shadow-md hover:bg-accent transition-colors",
        className
      )}
      {...props}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  )
}

export function CarouselNext({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "absolute right-2 top-1/2 -translate-y-1/2 z-10 h-8 w-8 rounded-full bg-background/80 border shadow-md hover:bg-accent transition-colors",
        className
      )}
      {...props}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}