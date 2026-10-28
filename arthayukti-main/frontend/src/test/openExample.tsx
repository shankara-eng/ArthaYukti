import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import App from '../App'

/** Opens the labelled example household the way a person would, then goes to a screen. */
export async function openExample(route: string) {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /example household/i }))
  await waitFor(() => expect(window.location.hash).toBe('#/plan'))
  window.location.hash = `/${route}`
}
