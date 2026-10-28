const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/

export function validEmail(value: string): boolean {
  return EMAIL.test(value.trim()) && value.trim().length <= 254
}

/** Convenience checks only. The server decides what is acceptable. */
export function validNewPassword(password: string): 'short' | 'letters' | null {
  if (password.length < 10) return 'short'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'letters'
  return null
}
