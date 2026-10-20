export const ID: 'opencode-free'
export const BASE: string
export const DIRECTORY: string
export const DOCS: string
export const candidates: string[]
export interface CatalogModel {
  id: string
  service?: 'zen' | 'go'
  name: string
  price: 'free' | 'paid' | 'unknown'
  available: boolean
  api: 'openai-completions' | null
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number } | null
}
export function parseCatalog(
  directory: unknown,
  html: string,
  known?: { id: string }[],
  service?: 'zen' | 'go'
): CatalogModel[]
export function errorCode(status: number, body?: string): string
export function boundedText(response: Response, maximum?: number): Promise<string>
export function request(url: string, init?: RequestInit, fetcher?: typeof fetch): Promise<Response>
export function fetchCatalog(
  known?: { id: string }[],
  signal?: AbortSignal,
  fetcher?: typeof fetch,
  service?: 'zen' | 'go'
): Promise<CatalogModel[]>

export function assertAllowed(
  id: string,
  state: import('../../src/shared/providers/opencode-free').OpenCodeFreeState,
  signal?: AbortSignal,
  fetcher?: typeof fetch
): Promise<CatalogModel>

export const CONFIG: string
export function authorizedModels(
  key: string,
  signal?: AbortSignal,
  fetcher?: typeof fetch
): Promise<string[]>

export function safeErrorCode(error: unknown): string

export const GO_BASE: string
export const GO_DIRECTORY: string
export const GO_DOCS: string
export function serviceBase(service?: 'zen' | 'go'): string
export function authorizedAccess(
  key: string,
  signal?: AbortSignal,
  fetcher?: typeof fetch
): Promise<{ modelIds: string[]; routes: Record<string, 'zen' | 'go'> }>
