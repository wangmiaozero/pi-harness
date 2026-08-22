import type { MascotStyle } from '@shared/constants/mascot'
import knowledgeImage from '@renderer/assets/mascot/pico-knowledge.png'
import engineerImage from '@renderer/assets/mascot/pico-engineer.png'
import maidImage from '@renderer/assets/mascot/pico-maid.png'
import matureImage from '@renderer/assets/mascot/pico-mature.png'
import officeImage from '@renderer/assets/mascot/pico-office.png'
import maidWhiteImage from '@renderer/assets/mascot/pico-maid-white.png'

export const MASCOT_IMAGES: Record<MascotStyle, string | null> = {
  none: null,
  knowledge: knowledgeImage,
  engineer: engineerImage,
  maid: maidImage,
  mature: matureImage,
  office: officeImage,
  maidWhite: maidWhiteImage
}
