/**
 * Desktop pet bubble copy — a compact standalone map instead of the full
 * vue-i18n bundle, keeping the pet window lightweight. Mirrors the
 * `pet.bubble.*` keys used by the in-app mascot locales.
 */

import { resolveAppLocale, type AppLanguage, type AppLocale } from '@shared/constants/language'

export interface BubbleMessages {
  idle: string
  sleeping: string
  thinking: string
  running: string
  toolCalling: string
  coding: string
  waiting: string
  success: string
  failed: string
  warning: string
  headPat: string
  poke: string
  eatToken: string
}

export const BUBBLE_MESSAGES: Record<AppLocale, BubbleMessages> = {
  'en-US': {
    idle: 'All quiet — ready when you are.',
    sleeping: 'Zzz… wake me when there is work.',
    thinking: 'Hmm, let me think…',
    running: 'On it! Working now.',
    toolCalling: 'Using a tool…',
    coding: 'Writing some code…',
    waiting: 'Your turn — I need input!',
    success: 'Done! All green ✅',
    failed: 'Something broke… 😿',
    warning: 'Heads up — minor trouble.',
    headPat: 'Swish~ that tickles!',
    poke: 'Boop!',
    eatToken: 'Nom nom, tasty tokens!'
  },
  'zh-CN': {
    idle: '一切安静，随时待命～',
    sleeping: 'Zzz… 有活儿叫我',
    thinking: '让我想想…',
    running: '干活中，勿扰～',
    toolCalling: '调用工具中…',
    coding: '敲代码中…',
    waiting: '该你了，需要输入！',
    success: '搞定！全绿 ✅',
    failed: '出错了…呜',
    warning: '注意，有点小问题。',
    headPat: '呼～好舒服！',
    poke: '戳我干嘛！',
    eatToken: '嗷呜，token 真香！'
  },
  'zh-TW': {
    idle: '一切安靜，隨時待命～',
    sleeping: 'Zzz… 有工作叫我',
    thinking: '讓我想想…',
    running: '工作中，勿擾～',
    toolCalling: '呼叫工具中…',
    coding: '寫程式中…',
    waiting: '該你了，需要輸入！',
    success: '搞定！全綠 ✅',
    failed: '出錯了…嗚',
    warning: '注意，有點小問題。',
    headPat: '呼～好舒服！',
    poke: '戳我幹嘛！',
    eatToken: '嗷嗚，token 真香！'
  },
  'ja-JP': {
    idle: '静かに待機中、いつでもどうぞ～',
    sleeping: 'Zzz… 仕事があれば呼んで',
    thinking: 'ええっと、考え中…',
    running: '作業中、邪魔しないで～',
    toolCalling: 'ツールを呼び出し中…',
    coding: 'コード書いてます…',
    waiting: '入力をお願い！',
    success: '完了！全クリア ✅',
    failed: 'エラーが出ちゃった…',
    warning: 'ちょっと注意です。',
    headPat: 'ふわ～気持ちいい！',
    poke: 'つつかないで！',
    eatToken: 'もぐもぐ、token 美味しい！'
  },
  'ko-KR': {
    idle: '조용히 대기 중, 언제든지요~',
    sleeping: 'Zzz… 일 있으면 불러줘',
    thinking: '음, 생각 중…',
    running: '작업 중, 방해 금지~',
    toolCalling: '도구 호출 중…',
    coding: '코딩 중…',
    waiting: '입력이 필요해요!',
    success: '완료! 모두 초록 ✅',
    failed: '뭔가 깨졌어요…',
    warning: '조심, 사소한 문제가 있어요.',
    headPat: '스윽~ 기분 좋아!',
    poke: '왜 찌르세요!',
    eatToken: '냠냠, token 맛있어!'
  },
  'de-DE': {
    idle: 'Ruhe — bereit, wenn du es bist.',
    sleeping: 'Zzz… weck mich bei Arbeit.',
    thinking: 'Hmm, lass mich nachdenken…',
    running: 'Bin dran! Arbeite gerade.',
    toolCalling: 'Nutze ein Werkzeug…',
    coding: 'Schreibe etwas Code…',
    waiting: 'Du bist dran — ich brauche Input!',
    success: 'Fertig! Alles grün ✅',
    failed: 'Etwas ist kaputt… 😿',
    warning: 'Achtung — kleines Problem.',
    headPat: 'Wusch~ das kitzelt!',
    poke: 'Stubs mich nicht!',
    eatToken: 'Mampf, leckere Tokens!'
  },
  'fr-FR': {
    idle: 'Tout est calme — prêt quand vous voulez.',
    sleeping: 'Zzz… réveille-moi s\u2019il y a du travail.',
    thinking: 'Hmm, laisse-moi réfléchir…',
    running: 'Je m\u2019en occupe !',
    toolCalling: 'J\u2019utilise un outil…',
    coding: 'J\u2019écrit du code…',
    waiting: 'À toi — j\u2019ai besoin d\u2019une entrée !',
    success: 'Terminé ! Tout est vert ✅',
    failed: 'Quelque chose a cassé… 😿',
    warning: 'Attention — petit souci.',
    headPat: 'Swish~ ça chatouille !',
    poke: 'Ne me pique pas !',
    eatToken: 'Miam miam, des tokens !'
  },
  'ru-RU': {
    idle: 'Тихо — готов, когда понадобится.',
    sleeping: 'Zzz… разбуди, если будет работа.',
    thinking: 'Хм, дай подумать…',
    running: 'Уже работаю!',
    toolCalling: 'Использую инструмент…',
    coding: 'Пишу код…',
    waiting: 'Твой ход — нужен ввод!',
    success: 'Готово! Всё зелёное ✅',
    failed: 'Что-то сломалось… 😿',
    warning: 'Осторожно — мелкая проблема.',
    headPat: 'Вжух~ щекотно!',
    poke: 'Не тыкай!',
    eatToken: 'Ням-ням, вкусные токены!'
  }
}

/** Use the same system-locale resolution as the application UI. */
export function bubbleMessages(language: AppLanguage): BubbleMessages {
  return BUBBLE_MESSAGES[resolveAppLocale(language, navigator.language)]
}
