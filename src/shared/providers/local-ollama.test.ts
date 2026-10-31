import { expect, it } from 'vitest'
import { isLocalOllamaEndpoint } from './local-ollama'

it.each(['http://localhost:11434/v1', 'http://127.0.0.1:11434', 'http://[::1]:11434/v1/'])(
  'recognizes a standard local Ollama endpoint: %s',
  (url) => expect(isLocalOllamaEndpoint(url)).toBe(true)
)

it.each([
  'https://ollama.com/v1',
  'http://localhost.example.com:11434/v1',
  'http://192.168.1.2:11434/v1',
  'http://localhost:1234/v1',
  'http://localhost:11434/proxy/v1',
  'http://user:password@localhost:11434/v1',
  'http://localhost:11434/v1?key=fixture',
  'not-a-url'
])('keeps other or authenticated URLs on the regular path: %s', (url) => {
  expect(isLocalOllamaEndpoint(url)).toBe(false)
})
