import type { ResultAsync } from 'neverthrow'
import type { UIMessageType } from '../entity/message'

export abstract class ThreadRepo {
  readonly userId: string
  readonly scope: string

  constructor(props: { userId: string; scope: string }) {
    this.userId = props.userId
    this.scope = props.scope
  }

  abstract getThreads(): ResultAsync<{ id: string; name: string }[], Error>
  abstract getThreadMessages(threadId: string): ResultAsync<UIMessageType[], Error>
  abstract upsertMessage(threadId: string, message: UIMessageType): ResultAsync<void, Error>
  abstract deleteThread(threadId: string): ResultAsync<void, Error>
}
