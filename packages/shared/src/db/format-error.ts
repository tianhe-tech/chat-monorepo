import { DatabaseError } from 'pg'
import { DrizzleQueryError } from 'drizzle-orm'

export function formatDBErrorMessage(err: unknown): string {
  if (!(err instanceof DrizzleQueryError)) {
    if (err instanceof Error) {
      return `UNKNOWN_DB_ERROR: ${err.name} - ${err.message}`
    }
    return `UNKNOWN_DB_ERROR: ${String(err)}`
  }

  const cause = err.cause
  if (!(cause instanceof DatabaseError)) {
    return `DRIZZLE_QUERY_ERROR: ${err.message}${err.cause ? `. Cause: ${String(err.cause)}` : ''}`
  }

  const pgError = cause
  const code = pgError.code
  const detail = pgError.detail
  const constraint = pgError.constraint
  const table = pgError.table
  const column = pgError.column

  switch (code) {
    case '23505': // unique_violation
      return `UNIQUE_CONSTRAINT_VIOLATION: Duplicate value violates unique constraint${constraint ? ` "${constraint}"` : ''}${table ? ` on table "${table}"` : ''}${column ? ` for column "${column}"` : ''}${detail ? `. Detail: ${detail}` : ''}`

    case '23503': // foreign_key_violation
      return `FOREIGN_KEY_VIOLATION: Foreign key constraint violated${constraint ? ` "${constraint}"` : ''}${table ? ` on table "${table}"` : ''}${detail ? `. Detail: ${detail}` : ''}`

    case '23502': // not_null_violation
      return `NOT_NULL_VIOLATION: Column cannot be null${table ? ` in table "${table}"` : ''}${column ? ` for column "${column}"` : ''}`

    case '23514': // check_violation
      return `CHECK_CONSTRAINT_VIOLATION: Check constraint violated${constraint ? ` "${constraint}"` : ''}${table ? ` on table "${table}"` : ''}${detail ? `. Detail: ${detail}` : ''}`

    case '42P01': // undefined_table
      return `UNDEFINED_TABLE: Table does not exist${table ? ` "${table}"` : ''}`

    case '42703': // undefined_column
      return `UNDEFINED_COLUMN: Column does not exist${column ? ` "${column}"` : ''}${table ? ` in table "${table}"` : ''}`

    case '42883': // undefined_function
      return `UNDEFINED_FUNCTION: Function does not exist. ${pgError.message}`

    case '25P02': // in_failed_sql_transaction
      return `TRANSACTION_FAILED: Current transaction is aborted. ${pgError.message}`

    case '40001': // serialization_failure
      return `SERIALIZATION_FAILURE: Transaction conflict detected, retry may be needed. ${pgError.message}`

    case '53300': // too_many_connections
      return `TOO_MANY_CONNECTIONS: Database connection limit reached. ${pgError.message}`

    case '08000': // connection_exception
    case '08003': // connection_does_not_exist
    case '08006': // connection_failure
      return `CONNECTION_ERROR: Database connection issue (${code}). ${pgError.message}`

    case '57014': // query_canceled
      return `QUERY_CANCELED: Query was canceled. ${pgError.message}`

    case '54000': // program_limit_exceeded
      return `PROGRAM_LIMIT_EXCEEDED: Query complexity or resource limit exceeded. ${pgError.message}`

    default:
      return `DATABASE_ERROR: PostgreSQL error (${code}) - ${pgError.message}${constraint ? `. Constraint: ${constraint}` : ''}${table ? `. Table: ${table}` : ''}${column ? `. Column: ${column}` : ''}`
  }
}
