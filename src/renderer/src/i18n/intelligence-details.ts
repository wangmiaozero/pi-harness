import { resolveAppLocale, type AppLocale } from '@shared/constants/language'

// The persisted diagnostic/evidence values stay stable across UI languages.
const warningPatterns = [
  /^Static (?:import relationships|declarations)/,
  /^Scan limit reached/,
  /^AI descriptions/,
  /^AI analysis was unavailable/,
  /^Source changed during analysis/,
  /^The architecture viewer/,
  /^(?:The map displays|The interactive map shows)/,
  /^A damaged or unsupported snapshot/
]
const warnings: Record<AppLocale, string[]> = {
  'en-US': [
    'Static imports locate source dependencies, not runtime data flows. Other languages and computed imports have limited coverage.',
    'Scan limits were reached; results are partial.',
    'AI descriptions use limited excerpts and need current-source review.',
    'AI analysis was unavailable or invalid. Local results are preserved.',
    'Source changed during analysis; reanalyze before using references.',
    'The map could not be rendered. The source index is still available.',
    'The map shows up to 48 modules at a time. Use pages or focus a module to see more.',
    'A damaged snapshot was skipped. Showing a valid earlier snapshot.'
  ],
  'zh-CN': [
    '静态导入用于定位源码依赖，不代表运行时数据流。其他语言和计算生成的导入关系覆盖有限。',
    '已达到扫描上限，当前结果为部分分析。',
    'AI 描述来自有限源码片段，仍需核对当前源码。',
    'AI 分析不可用或结果未通过验证，本地结果已保留。',
    '分析过程中源码发生变化，请重新分析后再使用引用。',
    '架构图生成失败，源码索引仍可使用。',
    '地图每次最多展示 48 个模块，可翻页或聚焦模块查看其他文件。',
    '已跳过损坏的快照，当前展示较早的有效结果。'
  ],
  'zh-TW': [
    '靜態匯入用於定位原始碼相依，不代表執行時資料流。其他語言與動態計算的匯入覆蓋有限。',
    '已達掃描上限，結果為部分分析。',
    'AI 描述來自有限片段，仍須核對目前原始碼。',
    'AI 分析不可用或未通過驗證，本機結果已保留。',
    '分析期間原始碼有變更，請重新分析後再使用引用。',
    '架構圖產生失敗，原始碼索引仍可使用。',
    '每次最多顯示 48 個模組，可翻頁或聚焦模組查看更多。',
    '已略過損壞快照，顯示較早的有效結果。'
  ],
  'ja-JP': [
    '静的インポートはソース依存を示し、実行時のデータフローは示しません。他言語と計算されたインポートの分析範囲は限定的です。',
    '調査上限に達したため、結果は部分的です。',
    'AI の説明は限られた抜粋に基づきます。現在のソースを確認してください。',
    'AI 分析を利用または検証できませんでした。ローカル結果は保持されています。',
    '分析中にソースが変更されました。参照の利用前に再分析してください。',
    '構成図を生成できませんでした。ソース索引は利用できます。',
    '一度に最大 48 モジュールを表示します。ページ切替やモジュールへの注目で続きを確認できます。',
    '破損したスナップショットを省略し、以前の有効な結果を表示しています。'
  ],
  'ko-KR': [
    '정적 가져오기는 소스 의존 관계를 나타내며 실행 중 데이터 흐름은 아닙니다. 다른 언어와 계산된 가져오기의 분석 범위는 제한됩니다.',
    '검사 한도에 도달하여 일부 결과만 표시합니다.',
    'AI 설명은 제한된 발췌에 기반합니다. 현재 소스를 확인하세요.',
    'AI 분석을 사용할 수 없거나 검증에 실패했습니다. 로컬 결과는 유지됩니다.',
    '분석 중 소스가 변경되었습니다. 참조를 사용하기 전에 다시 분석하세요.',
    '구조도를 생성하지 못했습니다. 소스 색인은 사용할 수 있습니다.',
    '한 번에 최대 48개 모듈을 표시합니다. 페이지 이동 또는 모듈 집중 보기로 더 확인하세요.',
    '손상된 스냅샷을 건너뛰고 이전의 유효한 결과를 표시합니다.'
  ],
  'ru-RU': [
    'Статические импорты показывают зависимости кода, а не потоки данных при выполнении. Другие языки и вычисляемые импорты охвачены частично.',
    'Достигнут предел проверки; результаты частичные.',
    'Описание ИИ основано на ограниченных фрагментах. Проверьте актуальный код.',
    'ИИ-анализ недоступен или не прошёл проверку. Локальные результаты сохранены.',
    'Код изменился во время анализа. Повторите анализ перед использованием ссылок.',
    'Схема не построена. Индекс кода по-прежнему доступен.',
    'Показано до 48 модулей. Переключайте страницы или выделяйте модуль для просмотра остальных.',
    'Повреждённый снимок пропущен. Показан предыдущий корректный результат.'
  ],
  'fr-FR': [
    'Les imports statiques indiquent des dépendances du code, pas des flux à l’exécution. Les autres langages et imports calculés sont partiellement couverts.',
    'La limite d’analyse a été atteinte ; les résultats sont partiels.',
    'Les descriptions IA reposent sur des extraits limités. Vérifiez le code actuel.',
    'L’analyse IA est indisponible ou invalide. Les résultats locaux sont conservés.',
    'Le code a changé pendant l’analyse. Relancez-la avant d’utiliser les références.',
    'La carte n’a pas pu être créée. L’index du code reste disponible.',
    'La carte affiche 48 modules au maximum. Changez de page ou centrez un module pour en voir davantage.',
    'Un instantané endommagé a été ignoré. Un résultat antérieur valide est affiché.'
  ],
  'de-DE': [
    'Statische Imports zeigen Quellabhängigkeiten, keine Datenflüsse zur Laufzeit. Andere Sprachen und berechnete Imports werden nur teilweise erfasst.',
    'Prüflimit erreicht; die Ergebnisse sind unvollständig.',
    'KI-Beschreibungen beruhen auf begrenzten Auszügen. Prüfe den aktuellen Code.',
    'KI-Analyse nicht verfügbar oder ungültig. Lokale Ergebnisse bleiben erhalten.',
    'Code während der Analyse geändert. Vor Verwendung der Verweise erneut analysieren.',
    'Die Karte konnte nicht erstellt werden. Der Quellindex bleibt verfügbar.',
    'Bis zu 48 Module pro Ansicht. Weitere Module über Seiten oder Modul-Fokus anzeigen.',
    'Beschädigten Snapshot übersprungen. Ein früheres gültiges Ergebnis wird angezeigt.'
  ]
}
const labels: Record<AppLocale, string[]> = {
  'en-US': [
    'Source',
    'UI',
    'Tests',
    'API (inferred)',
    'Data (inferred)',
    'Verified in source',
    'AI inference',
    'Unverified'
  ],
  'zh-CN': [
    '源码',
    '界面',
    '测试',
    'API（推测）',
    '数据（推测）',
    '源码已验证',
    'AI 推断',
    '未验证'
  ],
  'zh-TW': [
    '原始碼',
    '介面',
    '測試',
    'API（推測）',
    '資料（推測）',
    '原始碼已驗證',
    'AI 推論',
    '未驗證'
  ],
  'ja-JP': [
    'ソース',
    'UI',
    'テスト',
    'API（推定）',
    'データ（推定）',
    'ソースで確認済み',
    'AI による推定',
    '未確認'
  ],
  'ko-KR': [
    '소스',
    'UI',
    '테스트',
    'API (추정)',
    '데이터 (추정)',
    '소스에서 확인됨',
    'AI 추론',
    '미검증'
  ],
  'ru-RU': [
    'Код',
    'Интерфейс',
    'Тесты',
    'API (предположение)',
    'Данные (предположение)',
    'Проверено в коде',
    'Вывод ИИ',
    'Не проверено'
  ],
  'fr-FR': [
    'Code',
    'Interface',
    'Tests',
    'API (inférée)',
    'Données (inférées)',
    'Vérifié dans le code',
    'Inférence IA',
    'Non vérifié'
  ],
  'de-DE': [
    'Code',
    'Oberfläche',
    'Tests',
    'API (vermutet)',
    'Daten (vermutet)',
    'Im Code geprüft',
    'KI-Schlussfolgerung',
    'Ungeprüft'
  ]
}
export function architectureWarning(warning: string, locale: string): string {
  const index = warningPatterns.findIndex((pattern) => pattern.test(warning))
  return index < 0 ? warning : warnings[resolveAppLocale('auto', locale)][index]
}
export function architectureLabel(value: string, locale: string): string {
  const index = [
    'source',
    'ui',
    'test',
    'api',
    'data',
    'static-verified',
    'ai-inferred',
    'unverified'
  ].indexOf(value)
  return index < 0 ? value : labels[resolveAppLocale('auto', locale)][index]
}
