import { DrizzleQueryError } from 'drizzle-orm'
import { DatabaseError } from 'pg'

export class ConstraintViolationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ConstraintViolationError'
  }
}

export class ConnectionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ConnectionError'
  }
}

export class UnknownDBError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'UnknownDBError'
  }
}

export type ConstructedDBError = {
  message: string
  error: Error
}

const CONSTRAINT_CODES = new Set(['23505', '23503', '23502', '23514'])
const CONNECTION_CODES = new Set(['53300', '08000', '08003', '08006'])

const DEFAULT_UNKNOWN_MESSAGE = 'UNKNOWN_DB_ERROR: An unexpected database error occurred.'

export function constructDBError(err: unknown): ConstructedDBError {
  const drizzleError = err instanceof DrizzleQueryError ? err : null
  const pgError =
    err instanceof DatabaseError ? err : drizzleError?.cause instanceof DatabaseError ? drizzleError.cause : null

  if (!drizzleError && !pgError) {
    const message =
      err instanceof Error ? `UNKNOWN_DB_ERROR: ${err.name} - ${err.message}` : `UNKNOWN_DB_ERROR: ${String(err)}`

    return {
      message,
      error: new UnknownDBError(message, { cause: err }),
    }
  }

  if (drizzleError && !pgError) {
    const causeMessage = drizzleError.cause ? ` Cause: ${String(drizzleError.cause)}` : ''
    const message = `DRIZZLE_QUERY_ERROR: ${drizzleError.message}${causeMessage}`

    return {
      message,
      error: new UnknownDBError(message, { cause: drizzleError }),
    }
  }

  if (!pgError) {
    const message = DEFAULT_UNKNOWN_MESSAGE
    return { message, error: new UnknownDBError(message, { cause: err }) }
  }

  const message = buildMessageFromPGError(pgError)
  const error = createSpecializedError(pgError, message)

  return { message, error }
}

function buildMessageFromPGError(pgError: DatabaseError): string {
  const { code } = pgError

  if (CONSTRAINT_CODES.has(code!)) {
    return buildConstraintMessage(pgError)
  }

  if (CONNECTION_CODES.has(code!)) {
    return buildConnectionMessage(pgError)
  }

  return buildGenericMessage(pgError)
}

function buildConstraintMessage(pgError: DatabaseError): string {
  const { code, detail, constraint, table, column } = pgError
  const constraintInfo = constraint ? ` "${constraint}"` : ''
  const tableInfo = table ? ` on table "${table}"` : ''
  const columnInfo = column ? ` for column "${column}"` : ''
  const detailInfo = detail ? `. Detail: ${detail}` : ''

  switch (code) {
    case '23505':
      return `UNIQUE_CONSTRAINT_VIOLATION: Duplicate value violates unique constraint${constraintInfo}${tableInfo}${columnInfo}${detailInfo}`
    case '23503':
      return `FOREIGN_KEY_VIOLATION: Foreign key constraint violated${constraintInfo}${tableInfo}${detailInfo}`
    case '23502':
      return `NOT_NULL_VIOLATION: Column cannot be null${tableInfo}${columnInfo}`
    case '23514':
      return `CHECK_CONSTRAINT_VIOLATION: Check constraint violated${constraintInfo}${tableInfo}${detailInfo}`
    default:
      return `CONSTRAINT_VIOLATION: Constraint violated${constraintInfo}${tableInfo}${columnInfo}${detailInfo}`
  }
}

function buildConnectionMessage(pgError: DatabaseError): string {
  const { code, message } = pgError

  if (code === '53300') {
    return `TOO_MANY_CONNECTIONS: Database connection limit reached. ${message}`
  }

  return `CONNECTION_ERROR: Database connection issue (${code}). ${message}`
}

function buildGenericMessage(pgError: DatabaseError): string {
  const { code, message, constraint, table, column } = pgError
  const constraintInfo = constraint ? `. Constraint: ${constraint}` : ''
  const tableInfo = table ? `. Table: ${table}` : ''
  const columnInfo = column ? `. Column: ${column}` : ''

  return `DATABASE_ERROR: PostgreSQL error (${code}) - ${message}${constraintInfo}${tableInfo}${columnInfo}`
}

function createSpecializedError(pgError: DatabaseError, message: string): Error {
  const baseCause = { cause: pgError }

  if (CONSTRAINT_CODES.has(pgError.code!)) {
    return new ConstraintViolationError(message, baseCause)
  }

  if (CONNECTION_CODES.has(pgError.code!)) {
    return new ConnectionError(message, baseCause)
  }

  return new UnknownDBError(message, baseCause)
}
