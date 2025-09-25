import { streamText, convertToModelMessages, type UIMessage, type ChatTransport, type LanguageModel } from 'ai'

export function createSimpleClientOnlyTransport<TMessage extends UIMessage>(model: LanguageModel) {
  return new (class SimpleClientOnlyTransport implements ChatTransport<TMessage> {
    async sendMessages(options: Parameters<ChatTransport<TMessage>['sendMessages']>[0]) {
      const modelMessages = convertToModelMessages(options.messages)

      const result = streamText({
        messages: modelMessages,
        abortSignal: options.abortSignal,
        model,
      })

      return result.toUIMessageStream({ sendReasoning: true })
    }

    async reconnectToStream(_options: Parameters<ChatTransport<TMessage>['reconnectToStream']>[0]) {
      return null
    }
  })()
}
