import type { AppLanguage } from '@shared/constants/language'

const en = {
  quality: 'Generation quality',
  qualities: { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' },
  title: 'Images',
  featured: 'Featured',
  templates: 'Templates',
  library: 'My images',
  create: 'Create',
  useTemplate: 'Use template',
  showMore: 'Show more',
  showLess: 'Show less',
  referenceHint: 'Choose 1 photo',
  model: 'Select model',
  noModels: 'No configured image models',
  empty: 'Generated images will appear here.',
  running: 'Creating your image…',
  stop: 'Stop',
  useAsReference: 'Use as reference',
  removeConfirm: 'Delete this image from your library?',
  libraryError: 'Could not access your local image library.',
  templatesData: {
    landscape: {
      name: 'Alpine blue hour',
      prompt:
        'Editorial film photography of a white house beside a quiet alpine lake at blue hour. Pine forest, mist on the water, and cool indigo tones.'
    },
    product: {
      name: 'Studio product shot',
      prompt:
        'Create a studio product photograph of a pale sage perfume bottle on sculpted travertine. Use directional sunlight, soft shadows and an olive branch.'
    },
    illustration: {
      name: 'Painterly koi pond',
      prompt:
        'Paint two coral-orange koi swimming among lily pads in an ink-blue pond. Use visible paper grain and expressive brushwork.'
    },
    portrait: {
      name: 'Rainy city portrait',
      prompt:
        'Editorial photograph of an adult in a cobalt rain jacket under a clear umbrella, with blue-hour city reflections on wet pavement.'
    },
    storybook: {
      name: 'Floating village',
      prompt:
        'Paint a tiny red-roofed village on a floating island surrounded by clouds and hot air balloons, in vintage gouache.'
    },
    food: {
      name: 'Citrus in motion',
      prompt:
        'A pink grapefruit wedge and herbs suspended in sparkling water. Bright studio light, bubbles, and a pale pink background.'
    },
    architecture: {
      name: 'Museum light and shadow',
      prompt:
        'Architectural photograph of stone stairs rising through a sand-colored museum, with hard angled Mediterranean sunlight and deep shadows.'
    },
    sculpture: {
      name: 'Glass sculpture',
      prompt:
        'A lavender glass ribbon folded into a knot on a dusty-rose plinth. Surreal 3D still life with soft studio lighting and realistic refraction.'
    }
  }
}

const zh: typeof en = {
  quality: '生成强度',
  qualities: { auto: '自动', low: '低', medium: '中', high: '高' },
  title: '图像',
  featured: '热门',
  templates: '模板',
  library: '我的图像',
  create: '创作',
  useTemplate: '使用模板',
  showMore: '展开更多',
  showLess: '收起',
  referenceHint: '请选择 1 张照片',
  model: '选择模型',
  noModels: '暂无已配置的图像模型',
  empty: '生成的图像会保存在这里。',
  running: '正在生成图像…',
  stop: '终止',
  useAsReference: '用作参考图',
  removeConfirm: '从「我的图像」删除这张图像？',
  libraryError: '无法访问本地图像库。',
  templatesData: {
    landscape: {
      name: '高山蓝调时刻',
      prompt: '用胶片摄影风格拍摄蓝调时刻的高山湖畔。白色小屋、松树林和湖面薄雾，采用冷靛蓝色调。'
    },
    product: {
      name: '棚拍产品照',
      prompt:
        '为一瓶鼠尾草绿色的香水拍摄棚拍产品照。瓶子放在雕塑质感的洞石上，用定向日光、柔和阴影和橄榄枝点缀。'
    },
    illustration: {
      name: '手绘锦鲤池',
      prompt:
        '绘制墨蓝色池塘中的两尾珊瑚橙锦鲤，周围漂浮着荷叶。保留细腻的纸张纹理和富有表现力的笔触。'
    },
    portrait: {
      name: '雨夜人像',
      prompt: '拍摄一位穿钴蓝色雨衣、打透明伞的成年人。用蓝调街景、湿润路面的反光和自然的抓拍构图。'
    },
    storybook: {
      name: '漂浮村落',
      prompt: '用复古水粉绘制一座漂浮小岛上的红顶村落，周围是云朵和热气球。'
    },
    food: {
      name: '气泡柚子',
      prompt: '粉红西柚和香草悬浮在气泡水中。用明亮棚拍灯光、丰富气泡和浅粉背景。'
    },
    architecture: {
      name: '建筑光影',
      prompt: '拍摄暖沙色博物馆内的石阶，以地中海斜射的日光和深邃阴影塑造建筑空间。'
    },
    sculpture: {
      name: '玻璃雕塑',
      prompt:
        '一条薰衣草色玻璃带弯曲成结，摆在灰粉色底座上。使用柔和的棚拍灯光和真实折射，呈现超现实 3D 静物。'
    }
  }
}

export const imageStudioMessages = {
  'en-US': en,
  'zh-CN': zh,
  'zh-TW': {
    ...zh,
    quality: '生成強度',
    qualities: { auto: '自動', low: '低', medium: '中', high: '高' },
    title: '圖像',
    featured: '熱門',
    templates: '範本',
    library: '我的圖像',
    create: '創作',
    useTemplate: '使用範本',
    showMore: '展開更多',
    showLess: '收起',
    referenceHint: '請選擇 1 張照片',
    model: '選擇模型',
    noModels: '目前沒有已設定的圖像模型',
    empty: '生成的圖像會儲存在這裡。',
    running: '正在生成圖像…',
    stop: '終止',
    useAsReference: '用作參考圖',
    removeConfirm: '從「我的圖像」刪除這張圖像？',
    libraryError: '無法存取本機圖像庫。'
  },
  'ja-JP': {
    ...en,
    quality: '生成品質',
    qualities: { auto: '自動', low: '低', medium: '中', high: '高' },
    title: '画像',
    featured: 'おすすめ',
    templates: 'テンプレート',
    library: 'マイ画像',
    create: '作成',
    useTemplate: 'テンプレートを使う',
    showMore: 'もっと見る',
    showLess: '閉じる',
    referenceHint: '写真を 1 枚選択',
    model: 'モデルを選択',
    noModels: '設定済みの画像モデルがありません',
    empty: '生成した画像がここに表示されます。',
    running: '画像を生成しています…',
    stop: '停止',
    useAsReference: '参照画像として使う',
    removeConfirm: 'この画像をライブラリから削除しますか？',
    libraryError: 'ローカルの画像ライブラリにアクセスできません。'
  },
  'ko-KR': {
    ...en,
    quality: '생성 품질',
    qualities: { auto: '자동', low: '낮음', medium: '중간', high: '높음' },
    title: '이미지',
    featured: '추천',
    templates: '템플릿',
    library: '내 이미지',
    create: '만들기',
    useTemplate: '템플릿 사용',
    showMore: '더 보기',
    showLess: '접기',
    referenceHint: '사진 1장 선택',
    model: '모델 선택',
    noModels: '설정된 이미지 모델이 없습니다',
    empty: '생성된 이미지가 여기에 표시됩니다.',
    running: '이미지를 생성하는 중…',
    stop: '중지',
    useAsReference: '참조 이미지로 사용',
    removeConfirm: '라이브러리에서 이 이미지를 삭제할까요?',
    libraryError: '로컬 이미지 라이브러리에 접근할 수 없습니다.'
  },
  'ru-RU': {
    ...en,
    quality: 'Качество изображения',
    qualities: { auto: 'Авто', low: 'Низкое', medium: 'Среднее', high: 'Высокое' },
    title: 'Изображения',
    featured: 'Избранное',
    templates: 'Шаблоны',
    library: 'Мои изображения',
    create: 'Создание',
    useTemplate: 'Использовать шаблон',
    showMore: 'Ещё',
    showLess: 'Свернуть',
    referenceHint: 'Выберите 1 фото',
    model: 'Выберите модель',
    noModels: 'Модели для изображений не настроены',
    empty: 'Здесь появятся созданные изображения.',
    running: 'Создаём изображение…',
    stop: 'Остановить',
    useAsReference: 'Использовать как образец',
    removeConfirm: 'Удалить это изображение из библиотеки?',
    libraryError: 'Не удалось открыть локальную библиотеку изображений.'
  },
  'fr-FR': {
    ...en,
    quality: 'Qualité de génération',
    qualities: { auto: 'Auto', low: 'Basse', medium: 'Moyenne', high: 'Élevée' },
    title: 'Images',
    featured: 'À découvrir',
    templates: 'Exemples',
    library: 'Mes images',
    create: 'Créer',
    useTemplate: 'Utiliser le modèle',
    showMore: 'Voir plus',
    showLess: 'Réduire',
    referenceHint: 'Choisissez 1 photo',
    model: 'Choisir un modèle',
    noModels: 'Aucun modèle d’image configuré',
    empty: 'Vos images apparaîtront ici.',
    running: 'Création de l’image…',
    stop: 'Arrêter',
    useAsReference: 'Utiliser comme référence',
    removeConfirm: 'Supprimer cette image de la bibliothèque ?',
    libraryError: 'Impossible d’accéder à la galerie locale.'
  },
  'de-DE': {
    ...en,
    quality: 'Bildqualität',
    qualities: { auto: 'Auto', low: 'Niedrig', medium: 'Mittel', high: 'Hoch' },
    title: 'Bilder',
    featured: 'Entdecken',
    templates: 'Vorlagen',
    library: 'Meine Bilder',
    create: 'Erstellen',
    useTemplate: 'Vorlage verwenden',
    showMore: 'Mehr anzeigen',
    showLess: 'Weniger',
    referenceHint: '1 Foto auswählen',
    model: 'Modell auswählen',
    noModels: 'Keine Bildmodelle konfiguriert',
    empty: 'Erstellte Bilder erscheinen hier.',
    running: 'Bild wird erstellt…',
    stop: 'Stopp',
    useAsReference: 'Als Referenz verwenden',
    removeConfirm: 'Dieses Bild aus der Galerie löschen?',
    libraryError: 'Auf die lokale Bildergalerie konnte nicht zugegriffen werden.'
  }
} satisfies Record<Exclude<AppLanguage, 'auto'>, typeof en>
