import { z } from 'zod'

/** Browser callback finished; the app is exchanging the authorization code. */
export const chatGptConnectProgressSchema = z.object({ phase: z.literal('exchange') }).strict()

export function readChatGptConnectProgress(input: unknown): { phase: 'exchange' } | null {
  const parsed = chatGptConnectProgressSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
