import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom does not implement scrolling.
window.scrollTo = vi.fn()

// Pages are rendered by one worker among many, so a wait that is instant alone can take longer on a loaded machine.
// A longer limit changes nothing when the screen is ready sooner: it only stops a slow run from failing a correct test.
configure({ asyncUtilTimeout: 3000 })

afterEach(cleanup)
