import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SectionNavigator } from './SectionNavigator'
import { ThemeToggle, THEME_KEY } from './ThemeToggle'

const sections = [
  { id: 'one', label: 'Where you stand' },
  { id: 'two', label: 'Each month' },
  { id: 'gone', label: 'Not on the page' },
]

function mountPage() {
  return render(
    <div>
      <SectionNavigator label="On this page" sections={sections} />
      <section id="one" tabIndex={-1}>One</section>
      <section id="two" tabIndex={-1}>Two</section>
    </div>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  Element.prototype.scrollIntoView = vi.fn()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
})
afterEach(cleanup)

describe('SectionNavigator', () => {
  it('opens a list of the sections that exist and scrolls to the chosen one', async () => {
    mountPage()
    fireEvent.click(screen.getByRole('button', { name: 'On this page' }))
    const dialog = await screen.findByRole('dialog', { name: 'On this page' })
    expect(dialog.textContent).toContain('Where you stand')
    expect(dialog.textContent).not.toContain('Not on the page')

    fireEvent.click(screen.getByRole('button', { name: 'Each month' }))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes on Escape and puts focus back on the button', async () => {
    mountPage()
    const button = screen.getByRole('button', { name: 'On this page' })
    fireEvent.click(button)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(button)
  })

  it('moves between entries with the arrow keys', async () => {
    mountPage()
    fireEvent.click(screen.getByRole('button', { name: 'On this page' }))
    await screen.findByRole('dialog')
    expect(document.activeElement?.textContent).toBe('Where you stand')
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toBe('Each month')
  })
})

describe('ThemeToggle', () => {
  it('switches the theme, remembers the choice and names the next one', () => {
    render(<ThemeToggle light="Switch to light theme" dark="Switch to dark theme" />)
    expect(document.documentElement.dataset.theme).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()
  })

  it('starts from the saved choice', () => {
    window.localStorage.setItem(THEME_KEY, 'dark')
    render(<ThemeToggle light="Switch to light theme" dark="Switch to dark theme" />)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
