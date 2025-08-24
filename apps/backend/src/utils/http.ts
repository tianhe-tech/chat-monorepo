/**
 * Error message helper
 */
export function e<T>(message: string, data?: T) {
  return {
    __brand: 'http-error' as const,
    message,
    data,
  }
}
