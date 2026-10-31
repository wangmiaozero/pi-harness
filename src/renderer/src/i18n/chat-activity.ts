// Compact conversation activity labels, shared by calls and grouped history.
export const chatActivity = {
  'en-US': {
    noMatches: 'No matches',
    stepFailed: 'Step failed',
    failedExit: 'Failed (exit code {code})',
    failedSteps: 'Failed steps: {count}',
    endedWithErrors: 'Finished; failed steps: {count}',
    emptySearches: 'Searches with no results: {count}',
    running: {
      read: 'Reading file',
      search: 'Searching',
      write: 'Writing file',
      edit: 'Editing file',
      command: 'Running',
      tool: 'Running tool',
      thinking: 'Thinking'
    },
    pending: {
      read: 'Read file',
      search: 'Search',
      write: 'Write file',
      edit: 'Edit file',
      command: 'Run command',
      tool: 'Tool calls',
      thinking: 'Thinking'
    },
    done: {
      read: 'Read files',
      search: 'Searched',
      write: 'Wrote files',
      edit: 'Edited files',
      command: 'Ran commands',
      tool: 'Used tools',
      thinking: 'Thought'
    }
  },
  'zh-CN': {
    noMatches: '未找到结果',
    stepFailed: '步骤失败',
    failedExit: '执行失败（退出码 {code}）',
    failedSteps: '失败步骤：{count}',
    endedWithErrors: '已结束，部分步骤失败（{count}）',
    emptySearches: '无结果搜索：{count}',
    running: {
      read: '正在读取',
      search: '正在搜索',
      write: '正在写入',
      edit: '正在编辑',
      command: '正在运行',
      tool: '正在调用工具',
      thinking: '正在思考'
    },
    pending: {
      read: '读取文件',
      search: '搜索内容',
      write: '写入文件',
      edit: '编辑文件',
      command: '运行命令',
      tool: '工具调用',
      thinking: '思考'
    },
    done: {
      read: '已读取文件',
      search: '已搜索内容',
      write: '已写入文件',
      edit: '已编辑文件',
      command: '已运行命令',
      tool: '已调用工具',
      thinking: '已思考'
    }
  },
  'zh-TW': {
    noMatches: '未找到結果',
    stepFailed: '步驟失敗',
    failedExit: '執行失敗（結束碼 {code}）',
    failedSteps: '失敗步驟：{count}',
    endedWithErrors: '已結束，部分步驟失敗（{count}）',
    emptySearches: '無結果搜尋：{count}',
    running: {
      read: '正在讀取',
      search: '正在搜尋',
      write: '正在寫入',
      edit: '正在編輯',
      command: '正在執行',
      tool: '正在呼叫工具',
      thinking: '正在思考'
    },
    pending: {
      read: '讀取檔案',
      search: '搜尋內容',
      write: '寫入檔案',
      edit: '編輯檔案',
      command: '執行命令',
      tool: '工具呼叫',
      thinking: '思考'
    },
    done: {
      read: '已讀取檔案',
      search: '已搜尋內容',
      write: '已寫入檔案',
      edit: '已編輯檔案',
      command: '已執行命令',
      tool: '已呼叫工具',
      thinking: '已思考'
    }
  },
  'ja-JP': {
    noMatches: '一致なし',
    stepFailed: 'ステップ失敗',
    failedExit: '失敗（終了コード {code}）',
    failedSteps: '失敗したステップ: {count}',
    endedWithErrors: '終了・失敗したステップ: {count}',
    emptySearches: '一致のない検索: {count}',
    running: {
      read: '読み込み中',
      search: '検索中',
      write: '書き込み中',
      edit: '編集中',
      command: '実行中',
      tool: 'ツールを実行中',
      thinking: '思考中'
    },
    pending: {
      read: 'ファイルを読む',
      search: '検索',
      write: 'ファイルを書く',
      edit: 'ファイルを編集',
      command: 'コマンドを実行',
      tool: 'ツール呼び出し',
      thinking: '思考'
    },
    done: {
      read: 'ファイルを読み込みました',
      search: '検索しました',
      write: 'ファイルを書き込みました',
      edit: 'ファイルを編集しました',
      command: 'コマンドを実行しました',
      tool: 'ツールを使用しました',
      thinking: '思考しました'
    }
  },
  'ko-KR': {
    noMatches: '검색 결과 없음',
    stepFailed: '단계 실패',
    failedExit: '실패 (종료 코드 {code})',
    failedSteps: '실패한 단계: {count}',
    endedWithErrors: '종료됨 · 실패한 단계: {count}',
    emptySearches: '결과 없는 검색: {count}',
    running: {
      read: '읽는 중',
      search: '검색 중',
      write: '쓰는 중',
      edit: '편집 중',
      command: '실행 중',
      tool: '도구 실행 중',
      thinking: '생각 중'
    },
    pending: {
      read: '파일 읽기',
      search: '검색',
      write: '파일 쓰기',
      edit: '파일 편집',
      command: '명령 실행',
      tool: '도구 호출',
      thinking: '생각'
    },
    done: {
      read: '파일을 읽었습니다',
      search: '검색했습니다',
      write: '파일을 썼습니다',
      edit: '파일을 편집했습니다',
      command: '명령을 실행했습니다',
      tool: '도구를 사용했습니다',
      thinking: '생각했습니다'
    }
  },
  'de-DE': {
    noMatches: 'Keine Treffer',
    stepFailed: 'Schritt fehlgeschlagen',
    failedExit: 'Fehlgeschlagen (Exit-Code {code})',
    failedSteps: 'Fehlgeschlagene Schritte: {count}',
    endedWithErrors: 'Beendet; fehlgeschlagene Schritte: {count}',
    emptySearches: 'Suchen ohne Treffer: {count}',
    running: {
      read: 'Datei wird gelesen',
      search: 'Suche läuft',
      write: 'Datei wird geschrieben',
      edit: 'Datei wird bearbeitet',
      command: 'Wird ausgeführt',
      tool: 'Werkzeug läuft',
      thinking: 'Denkt nach'
    },
    pending: {
      read: 'Datei lesen',
      search: 'Suchen',
      write: 'Datei schreiben',
      edit: 'Datei bearbeiten',
      command: 'Befehl ausführen',
      tool: 'Werkzeugaufrufe',
      thinking: 'Nachdenken'
    },
    done: {
      read: 'Dateien gelesen',
      search: 'Gesucht',
      write: 'Dateien geschrieben',
      edit: 'Dateien bearbeitet',
      command: 'Befehle ausgeführt',
      tool: 'Werkzeuge verwendet',
      thinking: 'Nachgedacht'
    }
  },
  'fr-FR': {
    noMatches: 'Aucun résultat',
    stepFailed: 'Étape échouée',
    failedExit: 'Échec (code de sortie {code})',
    failedSteps: 'Étapes échouées : {count}',
    endedWithErrors: 'Terminé ; étapes échouées : {count}',
    emptySearches: 'Recherches sans résultat : {count}',
    running: {
      read: 'Lecture en cours',
      search: 'Recherche en cours',
      write: 'Écriture en cours',
      edit: 'Modification en cours',
      command: 'Exécution en cours',
      tool: 'Outil en cours',
      thinking: 'Réflexion en cours'
    },
    pending: {
      read: 'Lire un fichier',
      search: 'Rechercher',
      write: 'Écrire un fichier',
      edit: 'Modifier un fichier',
      command: 'Exécuter une commande',
      tool: 'Appels d’outils',
      thinking: 'Réflexion'
    },
    done: {
      read: 'Fichiers lus',
      search: 'Recherche effectuée',
      write: 'Fichiers écrits',
      edit: 'Fichiers modifiés',
      command: 'Commandes exécutées',
      tool: 'Outils utilisés',
      thinking: 'Réflexion terminée'
    }
  },
  'ru-RU': {
    noMatches: 'Совпадений нет',
    stepFailed: 'Ошибка шага',
    failedExit: 'Ошибка (код выхода {code})',
    failedSteps: 'Неудачных шагов: {count}',
    endedWithErrors: 'Завершено; неудачных шагов: {count}',
    emptySearches: 'Поисков без результатов: {count}',
    running: {
      read: 'Чтение файла',
      search: 'Поиск',
      write: 'Запись файла',
      edit: 'Редактирование файла',
      command: 'Выполняется',
      tool: 'Выполнение инструмента',
      thinking: 'Размышление'
    },
    pending: {
      read: 'Прочитать файл',
      search: 'Найти',
      write: 'Записать файл',
      edit: 'Изменить файл',
      command: 'Выполнить команду',
      tool: 'Вызовы инструментов',
      thinking: 'Размышление'
    },
    done: {
      read: 'Файлы прочитаны',
      search: 'Поиск выполнен',
      write: 'Файлы записаны',
      edit: 'Файлы изменены',
      command: 'Команды выполнены',
      tool: 'Инструменты использованы',
      thinking: 'Размышление завершено'
    }
  }
} as const
