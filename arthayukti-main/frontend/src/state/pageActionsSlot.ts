import { createContext } from 'react'

/** The toolbar slot the shell offers to pages; null until the shell has mounted it. */
export const PageActionsSlot = createContext<HTMLElement | null>(null)
