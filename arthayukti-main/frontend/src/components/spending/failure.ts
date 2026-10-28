import { ApiFailure } from '../../api/client'

/** The server's own explanation when there is one (it says what to fix), otherwise a plain retry message. */
export function failureText(failure: Error | null): string {
  return failure instanceof ApiFailure ? failure.message : failure ? 'Something went wrong. Please try again.' : ''
}
