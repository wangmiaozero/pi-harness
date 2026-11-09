import type { MascotStyle } from '@shared/constants/mascot'
import { PET_MANIFESTS } from '@renderer/pet/manifests'

export const MASCOT_IMAGES: Record<MascotStyle, string | null> = {
  none: null,
  maidWhite: PET_MANIFESTS.maidWhite?.sprite ?? null,
  office: PET_MANIFESTS.office?.sprite ?? null,
  starshipCockpit: PET_MANIFESTS.starshipCockpit?.sprite ?? null,
  noirScholar: PET_MANIFESTS.noirScholar?.sprite ?? null,
  moonlitMaid: PET_MANIFESTS.moonlitMaid?.sprite ?? null,
  mingSnow: PET_MANIFESTS.mingSnow?.sprite ?? null,
  zhangJuzhengSnow: PET_MANIFESTS.zhangJuzhengSnow?.sprite ?? null,
  mingMoon: PET_MANIFESTS.mingMoon?.sprite ?? null,
  ropeWhale: PET_MANIFESTS.ropeWhale?.sprite ?? null,
  ropePhoebe: PET_MANIFESTS.ropePhoebe?.sprite ?? null,
  ropeClaude: PET_MANIFESTS.ropeClaude?.sprite ?? null,
  ropeDeepseek: PET_MANIFESTS.ropeDeepseek?.sprite ?? null,
  deepseekPoster: PET_MANIFESTS.deepseekPoster?.sprite ?? null,
  deepseekDream: PET_MANIFESTS.deepseekDream?.sprite ?? null,
  ropeGemini: PET_MANIFESTS.ropeGemini?.sprite ?? null,
  ropeGpt: PET_MANIFESTS.ropeGpt?.sprite ?? null,
  ropeGlm: PET_MANIFESTS.ropeGlm?.sprite ?? null,
  ropeGrok: PET_MANIFESTS.ropeGrok?.sprite ?? null,
  ropeKimi: PET_MANIFESTS.ropeKimi?.sprite ?? null,
  ropeQwen: PET_MANIFESTS.ropeQwen?.sprite ?? null
}
