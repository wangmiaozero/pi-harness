import type { Model } from '@earendil-works/pi-ai'
import type { OpenCodeFreeState } from '../../src/shared/providers/opencode-free'
export function readState(file?: string): Promise<OpenCodeFreeState>
export function runtimeModels(state: OpenCodeFreeState): Model<'openai-completions'>[]

export function credentialSlot(state: Pick<OpenCodeFreeState, 'activeCredentialId'>): string
