import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Jar } from './Jar'

describe('Jar', () => {
  it('is described for screen readers', () => {
    render(<Jar level={1} tone="good" label="Home: On time" />)
    expect(screen.getByRole('img', { name: 'Home: On time' })).toBeInTheDocument()
  })

  it('draws water in the right colour for the tone', () => {
    const { container, rerender } = render(<Jar level={1} tone="good" label="a" />)
    expect(container.innerHTML).toContain('#1e9e6a')
    rerender(<Jar level={0.5} tone="late" label="a" />)
    expect(container.innerHTML).toContain('#d9573b')
  })

  it('shows an empty clay jar when nothing is saved', () => {
    const { container } = render(<Jar level={0} tone="late" label="a" />)
    expect(container.innerHTML).not.toContain('#d9573b')
    expect(container.innerHTML).toContain('#dc9a70')
  })

  it('keeps every jar in the page distinct', () => {
    const { container } = render(
      <>
        <Jar level={1} tone="good" label="one" />
        <Jar level={0.4} tone="late" label="two" />
      </>,
    )
    const ids = [...container.querySelectorAll('clipPath, linearGradient')].map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
