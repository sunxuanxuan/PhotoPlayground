import { GENERAL_BACKGROUND_REPLACE_PROMPT } from "@/lib/general-background-replace-prompt";

export type BackgroundPreset = {
  id: string;
  title: string;
  location: string;
  summary: string;
  prompt: string;
  assetPath: string | null;
  thumbnailPath: string | null;
  assetFileName: string | null;
  monogram: string;
  accent: string;
  tint: string;
};

export const GENERAL_BACKGROUND_PRESET_ID = "general-background";

export function isGeneralBackgroundPreset(
  preset: Pick<BackgroundPreset, "id"> | string | null | undefined,
) {
  const id = typeof preset === "string" ? preset : preset?.id;
  return id === GENERAL_BACKGROUND_PRESET_ID;
}

export type BackgroundCompatibilityGrade = "A" | "B" | "C";
export type BackgroundRecommendedCrop =
  | "full-body"
  | "three-quarter"
  | "half-body";

export type BackgroundPlacementProfile = {
  grade: BackgroundCompatibilityGrade;
  gradeLabel: string;
  recommendedCrop: BackgroundRecommendedCrop;
  recommendedCropLabel: string;
  note: string;
};

const BACKGROUND_PLACEMENT_CONFIG: Record<
  string,
  readonly [BackgroundCompatibilityGrade, BackgroundRecommendedCrop]
> = {
  "beijing-tiananmen": ["C", "half-body"],
  "beijing-wumen": ["A", "full-body"],
  "beijing-great-wall": ["A", "full-body"],
  "beijing-temple-of-heaven": ["A", "full-body"],
  "beijing-birds-nest": ["A", "full-body"],
  "beijing-universal-studios": ["A", "full-body"],
  "shanghai-lujiazui": ["B", "three-quarter"],
  "hangzhou-leifeng-pagoda": ["B", "half-body"],
  "jinan-daming-lake": ["B", "three-quarter"],
  "puer-tea-culture-wall": ["C", "half-body"],
  "taipusi-grassland": ["A", "full-body"],
  "datong-yungang-grottoes-entrance": ["A", "full-body"],
  "datong-yungang-buddha": ["B", "three-quarter"],
  "beijing-beihai-white-pagoda": ["C", "half-body"],
  "kunming-airport": ["A", "full-body"],
  "kunming-hello-wall": ["B", "three-quarter"],
  "puer-dai-jia-lane": ["A", "full-body"],
  "beijing-great-wall-overlook-vertical": ["A", "full-body"],
  "beijing-birds-nest-plaza-vertical": ["A", "full-body"],
  "shanghai-lujiazui-skyline-vertical": ["C", "half-body"],
  "taipusi-grassland-castle-wide": ["A", "full-body"],
  "xinjiang-flaming-mountains-monument": ["C", "half-body"],
  "xinjiang-kanas-moon-bay-vertical": ["C", "half-body"],
  "xinjiang-tianshan-pasture-wide": ["B", "three-quarter"],
  "xinjiang-grassland-yurts-wide": ["A", "full-body"],
  "xinjiang-snow-mountain-boardwalk-vertical": ["A", "full-body"],
  "xinjiang-turpan-multilingual-wall-wide": ["B", "three-quarter"],
  "xinjiang-turpan-grape-valley-book-vertical": ["C", "half-body"],
  "beijing-summer-palace-kunming-lake-vertical": ["C", "half-body"],
  "beijing-beihai-white-pagoda-bridge-vertical": ["C", "half-body"],
  "beijing-temple-of-heaven-red-wall-vertical": ["A", "full-body"],
  "beijing-great-wall-watchtower-vertical": ["C", "half-body"],
  "beijing-summer-palace-foxiang-pavilion-lakeside-vertical": ["C", "half-body"],
  "beijing-pku-west-gate-vertical": ["B", "three-quarter"],
  "beijing-tsinghua-university-gate-vertical": ["A", "full-body"],
  "beijing-old-summer-palace-ruins-vertical": ["A", "full-body"],
  "beijing-great-hall-of-people-wide": ["C", "half-body"],
  "paris-arc-de-triomphe-vertical": ["A", "full-body"],
  "giza-pyramids-vertical": ["A", "full-body"],
  "london-big-ben-westminster-vertical": ["C", "half-body"],
  "new-york-statue-of-liberty-vertical": ["C", "half-body"],
};

const GROUNDLESS_OVERRIDE_MARKERS = [
  "前景没有可见路面",
  "没有可见近景站立面",
  "没有清晰可站立地面",
  "画面几乎没有地面",
] as const;

const GRADE_LABELS: Record<BackgroundCompatibilityGrade, string> = {
  A: "可自然落地",
  B: "需要前景锚定",
  C: "仅建议半身",
};

const CROP_LABELS: Record<BackgroundRecommendedCrop, string> = {
  "full-body": "推荐全身 / 四分之三身",
  "three-quarter": "推荐四分之三身",
  "half-body": "推荐半身 / 胸像",
};

const GRADE_NOTES: Record<BackgroundCompatibilityGrade, string> = {
  A: "存在明确地面、坡面或步道，可建立落点、遮挡和接触阴影。",
  B: "地面或深度锚点有限，需要利用栏杆、墙面或近景遮挡建立前后关系。",
  C: "缺少可信落地点，只适合较小比例的半身前景，二维贴片风险较高。",
};

export function getBackgroundPlacementProfile(
  preset: Pick<BackgroundPreset, "id" | "prompt">,
): BackgroundPlacementProfile {
  const promptOverridesPlacement = GROUNDLESS_OVERRIDE_MARKERS.some((marker) =>
    preset.prompt.includes(marker),
  );
  const [configuredGrade, configuredCrop] =
    BACKGROUND_PLACEMENT_CONFIG[preset.id] ?? ["C", "half-body"];
  const grade = promptOverridesPlacement ? "C" : configuredGrade;
  const recommendedCrop = promptOverridesPlacement
    ? "half-body"
    : configuredCrop;

  return {
    grade,
    gradeLabel: GRADE_LABELS[grade],
    recommendedCrop,
    recommendedCropLabel: CROP_LABELS[recommendedCrop],
    note: GRADE_NOTES[grade],
  };
}

export function getBackgroundPresetPrompt(preset: BackgroundPreset) {
  return preset.prompt;
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    id: GENERAL_BACKGROUND_PRESET_ID,
    title: "通用模式",
    location: "自定义背景",
    summary: "不预设背景图片，仅使用固定通用提示词，适合上传任意目标背景",
    prompt: GENERAL_BACKGROUND_REPLACE_PROMPT,
    assetPath: null,
    thumbnailPath: null,
    assetFileName: null,
    monogram: "通",
    accent: "#7364a3",
    tint: "#ddd8ef",
  },
  {
    id: "beijing-tiananmen",
    title: "天安门广场 · 侧面",
    location: "北京 · 东城区",
    summary: "斜侧城楼、红色建筑与蓝天，适合低机位半身游客照",
    prompt:
      "场景：使用图2斜侧仰拍的中式城楼、红色建筑表面、蓝天、树篱与花坛，完整保留原有建筑轮廓、既有背景装饰和文字区域，不改写、放大或新增任何标志。清理：移除下部中央原女性及其服装、随身物品和原遮挡，连续补全树篱、花坛与栏杆。落位：前景没有可见路面，人物只能放在镜头与花坛之间的下部前景，采用半身或大半身，不得站入绿篱、花坛或远处建筑。裁切：从画面底边自然截出躯干，不补脚、道路或台阶。",
    assetPath: "/background-presets/beijing-tiananmen.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-tiananmen.jpeg",
    assetFileName: "beijing-tiananmen.jpeg",
    monogram: "京",
    accent: "#bb4d3e",
    tint: "#f5d7cb",
  },
  {
    id: "beijing-wumen",
    title: "故宫午门",
    location: "北京 · 故宫博物院",
    summary: "午门城楼、红墙与中轴广场，适合庄重的旅行纪念照",
    prompt:
      "场景：图2故宫午门、红墙与中轴广场。根据石板地面和门洞透视选择前景站位，保留午门主体辨识度。只通过整个人物的位置、尺度与裁切协调原拍摄视角，允许遮挡少量下部背景。完整脚部与路面可见时双脚落地，否则底边裁切。",
    assetPath: "/background-presets/beijing-wumen.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-wumen.jpeg",
    assetFileName: "beijing-wumen.jpeg",
    monogram: "门",
    accent: "#a94736",
    tint: "#e8c78f",
  },
  {
    id: "beijing-great-wall",
    title: "万里长城",
    location: "北京 · 长城",
    summary: "城墙、敌楼与连绵山脊，适合开阔壮观的旅行照",
    prompt:
      "场景：图2长城步道、城垛、敌楼与远处山脊。人物位于可行走步道上，依据砖石和步道消失线确定兼容原拍摄视角的距离与尺度。保留主要敌楼，身体不穿入城墙；无完整脚部时用底边裁切。",
    assetPath: "/background-presets/beijing-great-wall.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-great-wall.jpeg",
    assetFileName: "beijing-great-wall.jpeg",
    monogram: "城",
    accent: "#4f7551",
    tint: "#d6e0bd",
  },
  {
    id: "beijing-temple-of-heaven",
    title: "天坛祈年殿",
    location: "北京 · 天坛公园",
    summary: "祈年殿、汉白玉台基与开阔广场，适合地标合影",
    prompt:
      "场景：使用图2祈年殿、汉白玉台基与广场。移除图2前景中央两位主要游客及其残影，自然补全被遮挡的背景，远处游客可保留。落位：参考原游客站位与场景地面，选择兼容图1原拍摄视角和姿势的位置；只移动、等比缩放或裁切整个主体，不照搬原游客动作，尺度不设固定百分比。保留祈年殿辨识度，有完整脚部和路面时双脚自然落地，否则采用底边裁切。",
    assetPath: "/background-presets/beijing-temple-of-heaven.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-temple-of-heaven.jpeg",
    assetFileName: "beijing-temple-of-heaven.jpeg",
    monogram: "坛",
    accent: "#315f83",
    tint: "#c9dde4",
  },
  {
    id: "beijing-birds-nest",
    title: "国家体育场鸟巢",
    location: "北京 · 奥林匹克公园",
    summary: "鸟巢钢结构与开阔广场，适合现代城市打卡照",
    prompt:
      "场景：图2鸟巢钢结构与广场。移除前景主要人物及原阴影，补全地砖，远处游客可保留。以原站位和地砖消失线选择距离与尺度，不照搬原游客动作，保留鸟巢轮廓。脚部与地面都可见时自然落地，否则底边裁切。",
    assetPath: "/background-presets/beijing-birds-nest.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-birds-nest.jpeg",
    assetFileName: "beijing-birds-nest.jpeg",
    monogram: "巢",
    accent: "#657786",
    tint: "#dbe5eb",
  },
  {
    id: "beijing-universal-studios",
    title: "北京环球影城",
    location: "北京 · 环球度假区",
    summary: "环球影城地球标志与入口广场，适合活力旅行照",
    prompt:
      "场景：图2环球影城地球标志、入口建筑与广场。移除前景中央男性、背包与原阴影，补全背景，保留远处游客。选择地球标志前兼容图1原视角的位置，不照搬原游客动作；允许遮挡少量下部背景，保留地球标志辨识度。",
    assetPath: "/background-presets/beijing-universal-studios.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-universal-studios.jpeg",
    assetFileName: "beijing-universal-studios.jpeg",
    monogram: "球",
    accent: "#2d6f9f",
    tint: "#c5dfec",
  },
  {
    id: "shanghai-lujiazui",
    title: "上海陆家嘴",
    location: "上海 · 浦东新区",
    summary: "东方明珠与陆家嘴天际线，适合现代都市旅行照",
    prompt:
      "场景：图2东方明珠与陆家嘴天际线。人物只能位于下部真实人行空间，不进入机动车道或建筑内部。参考树木、路灯、道路和远景压缩关系选择距离与尺度，保留东方明珠与主要高楼辨识度；优先小幅移动与裁切，尺度不设固定百分比。",
    assetPath: "/background-presets/shanghai-lujiazui.jpeg",
    thumbnailPath: "/background-presets/thumbnails/shanghai-lujiazui.jpeg",
    assetFileName: "shanghai-lujiazui.jpeg",
    monogram: "沪",
    accent: "#675b9b",
    tint: "#d8d9ed",
  },
  {
    id: "hangzhou-leifeng-pagoda",
    title: "杭州雷峰塔",
    location: "杭州 · 西湖",
    summary: "西湖水面、远山与雷峰塔，适合柔和湖畔纪念照",
    prompt:
      "场景：图2西湖、雷峰塔、湖岸与远山。移除右侧前景女性及其物品，补全遮挡区域，保留湖面和游船设施。人物优先置于兼容图1原视角的湖畔近处，用底边裁切保留原身体，不站在水面。保留雷峰塔，允许遮挡少量下部湖景。",
    assetPath: "/background-presets/hangzhou-leifeng-pagoda.jpeg",
    thumbnailPath: "/background-presets/thumbnails/hangzhou-leifeng-pagoda.jpeg",
    assetFileName: "hangzhou-leifeng-pagoda.jpeg",
    monogram: "塔",
    accent: "#6c806d",
    tint: "#d9e1d6",
  },
  {
    id: "jinan-daming-lake",
    title: "济南大明湖",
    location: "济南 · 大明湖景区",
    summary: "大明湖福字碑、柳树与湖水，适合文化地标合影",
    prompt:
      "场景：图2大明湖福字碑、石栏、柳树与湖面。移除石碑右侧女性及背包、手机与原阴影，补全遮挡区域。人物选择碑旁兼容原拍摄视角的站位，保留碑面大字。完整脚部与地面可见时自然落地，否则底边裁切。",
    assetPath: "/background-presets/jinan-daming-lake.jpeg",
    thumbnailPath: "/background-presets/thumbnails/jinan-daming-lake.jpeg",
    assetFileName: "jinan-daming-lake.jpeg",
    monogram: "湖",
    accent: "#4f7a73",
    tint: "#d2e2da",
  },
  {
    id: "puer-tea-culture-wall",
    title: "普洱茶文化墙",
    location: "云南 · 普洱",
    summary: "砖墙茶文化彩绘，适合具有地方色彩的半身旅行照",
    prompt:
      "场景：图2普洱彩绘砖墙。墙面少数民族女性是绘画，保留她与普洱文字、茶叶图案和砖纹。人物放在下部靠侧近处，优先兼容图1原视角与半身裁切；画面几乎没有地面，不补脚。允许遮挡少量砖墙，保留中央文字和主要壁画。",
    assetPath: "/background-presets/puer-tea-culture-wall.jpeg",
    thumbnailPath: "/background-presets/thumbnails/puer-tea-culture-wall.jpeg",
    assetFileName: "puer-tea-culture-wall.jpeg",
    monogram: "茶",
    accent: "#8b503c",
    tint: "#ead3b5",
  },
  {
    id: "taipusi-grassland",
    title: "太仆寺旗草原",
    location: "内蒙古 · 太仆寺旗",
    summary: "起伏草坡、蓝天与白色城堡，适合开阔草原旅行照",
    prompt:
      "场景：图2草原坡面、山丘与右侧白色城堡。参考远处游客、坡度和地平线，选择兼容图1原姿势的草坡站位，不固定人物占比，保留草原与城堡辨识度。有原脚部与地面时顺应坡面落地，草叶可遮挡鞋底；否则采用底边裁切。",
    assetPath: "/background-presets/taipusi-grassland.jpeg",
    thumbnailPath: "/background-presets/thumbnails/taipusi-grassland.jpeg",
    assetFileName: "taipusi-grassland.jpeg",
    monogram: "原",
    accent: "#69804b",
    tint: "#dce3b6",
  },
  {
    id: "datong-yungang-grottoes-entrance",
    title: "云冈石窟入口",
    location: "大同 · 云冈石窟",
    summary: "世界文化遗产石碑与园林入口，适合地标纪念照",
    prompt:
      "场景：图2云冈石窟入口石碑与园林。移除左侧前景女性及背包、手持物和原阴影，补全遮挡区域，保留石碑形状、遗产标志与文字。人物置于碑旁兼容原拍摄视角的位置；只调整整体尺度与裁切，不照搬原游客动作。",
    assetPath: "/background-presets/datong-yungang-grottoes-entrance.jpeg",
    thumbnailPath: "/background-presets/thumbnails/datong-yungang-grottoes-entrance.jpeg",
    assetFileName: "datong-yungang-grottoes-entrance.jpeg",
    monogram: "窟",
    accent: "#8a684e",
    tint: "#e5d4bd",
  },
  {
    id: "datong-yungang-buddha",
    title: "云冈大佛",
    location: "大同 · 云冈石窟",
    summary: "石窟造像与岩壁肌理，适合庄重的人文旅行照",
    prompt:
      "场景：图2云冈大佛、岩壁与栏杆。保留全部佛像和岩壁造像；移除右下前景女性及黄色手持物和原阴影，补全背景。人物优先置于下部靠侧近处，选择兼容原视角的尺度与裁切，保留大佛面部，身体可遮挡少量下部栏杆。",
    assetPath: "/background-presets/datong-yungang-buddha.jpeg",
    thumbnailPath: "/background-presets/thumbnails/datong-yungang-buddha.jpeg",
    assetFileName: "datong-yungang-buddha.jpeg",
    monogram: "佛",
    accent: "#87634d",
    tint: "#ddc8ad",
  },
  {
    id: "beijing-beihai-white-pagoda",
    title: "北海公园白塔",
    location: "北京 · 北海公园",
    summary: "湖面、琼华岛与白塔远景，适合清雅湖畔旅行照",
    prompt:
      "场景：图2北海白塔、琼华岛、湖岸与水面。人物在下部靠侧的湖畔近处，选择兼容原视角的半身底边裁切，保留白塔辨识度，允许遮挡少量下部湖景。画面没有清晰可站立地面，不把人物放入水中或补造脚部。",
    assetPath: "/background-presets/beijing-beihai-white-pagoda.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-beihai-white-pagoda.jpeg",
    assetFileName: "beijing-beihai-white-pagoda.jpeg",
    monogram: "海",
    accent: "#657b86",
    tint: "#dbe2e4",
  },
  {
    id: "kunming-airport",
    title: "昆明机场打卡点",
    location: "昆明 · 长水国际机场",
    summary: "“我到云南啦”展陈与大象装置，适合抵达纪念照",
    prompt:
      "场景：图2昆明机场“我到云南啦”展陈。大象是展陈装置，完整保留它与文字、植物和屏幕。人物选择标牌侧方、兼容原视角的地砖站位，保留主要文字。完整脚部和路面可见时落地，否则底边裁切。",
    assetPath: "/background-presets/kunming-airport.jpeg",
    thumbnailPath: "/background-presets/thumbnails/kunming-airport.jpeg",
    assetFileName: "kunming-airport.jpeg",
    monogram: "滇",
    accent: "#4e8064",
    tint: "#d3e4d4",
  },
  {
    id: "kunming-hello-wall",
    title: "你好昆明墙",
    location: "昆明 · 城市打卡点",
    summary: "HELLO.KM 手绘墙与黑狗图案，适合轻松街头人像",
    prompt:
      "场景：图2 HELLO.KM 你好昆明墙与前景植物。移除中央女性及相机、包、牵引绳和原阴影，补全白墙。黑狗为墙面图案，保留它和中英文文字。人物置于兼容原视角的下部边侧位置，采用原身体范围内的裁切，不照搬原游客动作。",
    assetPath: "/background-presets/kunming-hello-wall.jpeg",
    thumbnailPath: "/background-presets/thumbnails/kunming-hello-wall.jpeg",
    assetFileName: "kunming-hello-wall.jpeg",
    monogram: "昆",
    accent: "#4e6c58",
    tint: "#d8e0d3",
  },
  {
    id: "puer-dai-jia-lane",
    title: "普洱戴家巷",
    location: "云南 · 普洱",
    summary: "趣味街牌、老街店铺与花墙，适合近距离打卡照",
    prompt:
      "场景：图2戴家巷街牌、店铺、黑板与花墙。移除前景男性及手持绿牌、相机、背带、背包和原阴影，补全遮挡区域；保留街牌中英文内容。人物选择兼容原视角的近处位置与裁切，允许遮挡少量下部背景，保留主要街牌。",
    assetPath: "/background-presets/puer-dai-jia-lane.jpeg",
    thumbnailPath: "/background-presets/thumbnails/puer-dai-jia-lane.jpeg",
    assetFileName: "puer-dai-jia-lane.jpeg",
    monogram: "巷",
    accent: "#895747",
    tint: "#ead1c8",
  },
  {
    id: "beijing-great-wall-overlook-vertical",
    title: "长城山脊步道",
    location: "北京 · 长城",
    summary: "纵向山脊、敌楼与近处砖石步道，适合完整旅行人像",
    prompt:
      "场景：图2纵向长城山脊、敌楼、城墙步道与远山。人物优先置于画面下部近处的真实砖石步道，依据城墙边线、阶梯和坡度选择兼容图1原视角的距离与尺度；保留上方敌楼和长城走势，身体不得穿入城垛。远处游客可保留；图1脚部完整时双脚沿步道落地，否则采用底边裁切。",
    assetPath: "/background-presets/beijing-great-wall-overlook-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-great-wall-overlook-vertical.jpeg",
    assetFileName: "beijing-great-wall-overlook-vertical.jpeg",
    monogram: "城",
    accent: "#5f7453",
    tint: "#d9e0c5",
  },
  {
    id: "beijing-birds-nest-plaza-vertical",
    title: "鸟巢广场 · 纵向",
    location: "北京 · 奥林匹克公园",
    summary: "鸟巢钢结构与开阔地砖广场，适合自然全身打卡照",
    prompt:
      "场景：图2鸟巢钢结构、开阔广场与蓝天。移除前景中央女性及其接触阴影，按周围地砖连续补全遮挡区域；远处游客可保留。人物优先使用原前景站位附近的真实地面，依据地砖消失线和鸟巢尺度确定位置，不照搬原人物动作。保留鸟巢完整轮廓；图1脚部完整时自然落地，否则底边裁切。",
    assetPath: "/background-presets/beijing-birds-nest-plaza-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-birds-nest-plaza-vertical.jpeg",
    assetFileName: "beijing-birds-nest-plaza-vertical.jpeg",
    monogram: "巢",
    accent: "#687b88",
    tint: "#dbe5eb",
  },
  {
    id: "shanghai-lujiazui-skyline-vertical",
    title: "陆家嘴天际线 · 纵向",
    location: "上海 · 浦东新区",
    summary: "东方明珠与高楼纵向构图，适合近景半身城市人像",
    prompt:
      "场景：图2东方明珠、上海中心、环球金融中心、金茂大厦、树木与下部人行空间。人物放在画面下部靠侧的镜头前景，采用半身或大半身底边裁切，避免以过小全身比例进入远景；不得站入机动车道、树冠或建筑。允许遮挡少量下部绿化，完整保留东方明珠和主要高楼轮廓。",
    assetPath: "/background-presets/shanghai-lujiazui-skyline-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/shanghai-lujiazui-skyline-vertical.jpeg",
    assetFileName: "shanghai-lujiazui-skyline-vertical.jpeg",
    monogram: "沪",
    accent: "#66739a",
    tint: "#d9deed",
  },
  {
    id: "taipusi-grassland-castle-wide",
    title: "草原白色城堡 · 横向",
    location: "内蒙古 · 太仆寺旗",
    summary: "宽幅草坡、远处城堡与大面积天空，适合开阔旅行照",
    prompt:
      "场景：图2宽幅草原坡面、右侧白色城堡、远处游客与蓝天。人物置于下部左侧或中部的近景草坡，依据坡度、地平线和远处游客尺度选择兼容图1视角的位置，保留右侧城堡与开阔天空。图1脚部完整时顺应草坡落地并允许草叶轻微遮挡鞋底，否则采用底边裁切；不得把人物放到城堡台阶或远处山脊上。",
    assetPath: "/background-presets/taipusi-grassland-castle-wide.jpeg",
    thumbnailPath: "/background-presets/thumbnails/taipusi-grassland-castle-wide.jpeg",
    assetFileName: "taipusi-grassland-castle-wide.jpeg",
    monogram: "原",
    accent: "#71804d",
    tint: "#dde3bb",
  },
  {
    id: "xinjiang-flaming-mountains-monument",
    title: "火焰山温度地标",
    location: "新疆 · 吐鲁番火焰山",
    summary: "“中国热极”温度石碑与赭色山体，适合地标纪念照",
    prompt:
      "场景：图2火焰山赭色山体与“中国热极 89℃ 吐鲁番火焰山”温度石碑。保留石碑造型、可见文字和远处山体。人物置于画面下部靠侧的镜头前景，优先采用半身或大半身底边裁切，可遮挡少量石座但不要遮住 89℃ 主标识；不得站在石碑、石座、围栏或远处山坡上，也不补造台阶。",
    assetPath: "/background-presets/xinjiang-flaming-mountains-monument.jpeg",
    thumbnailPath: "/background-presets/thumbnails/xinjiang-flaming-mountains-monument.jpeg",
    assetFileName: "xinjiang-flaming-mountains-monument.jpeg",
    monogram: "火",
    accent: "#a65a42",
    tint: "#edd1bf",
  },
  {
    id: "xinjiang-kanas-moon-bay-vertical",
    title: "喀纳斯月亮湾",
    location: "新疆 · 阿勒泰喀纳斯",
    summary: "俯瞰蓝绿色河湾与秋色山林，适合前景半身旅行照",
    prompt:
      "场景：图2俯瞰的喀纳斯蓝绿色月亮湾、河岸、山林与远山。画面没有可供人物站立的可见近景地面，人物只能从下部靠侧的镜头前景以半身或大半身底边裁切出现，作为观景者而非河谷中的人物。保留河湾完整曲线与主要林地，不把人物放入河水、树冠、河岸或远山，不补脚、平台或栏杆。",
    assetPath: "/background-presets/xinjiang-kanas-moon-bay-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/xinjiang-kanas-moon-bay-vertical.jpeg",
    assetFileName: "xinjiang-kanas-moon-bay-vertical.jpeg",
    monogram: "湾",
    accent: "#43818a",
    tint: "#cfe5e2",
  },
  {
    id: "xinjiang-tianshan-pasture-wide",
    title: "天山雪峰牧场",
    location: "新疆 · 天山草原",
    summary: "雪峰、云杉与毡房形成纵深层次，适合近景半身旅行照",
    prompt:
      "场景：图2天山雪峰、起伏草坡、云杉林与下部毡房。人物放在下部靠侧的镜头前景，优先使用半身或大半身底边裁切，以保留雪峰和纵深层次；若图1脚部完整且下方近景草坡清晰，可按坡面自然落地。人物不得站在毡房、树梢或远处山坡上，允许遮挡少量下部草地，但保留主要毡房和雪峰。",
    assetPath: "/background-presets/xinjiang-tianshan-pasture-wide.jpeg",
    thumbnailPath: "/background-presets/thumbnails/xinjiang-tianshan-pasture-wide.jpeg",
    assetFileName: "xinjiang-tianshan-pasture-wide.jpeg",
    monogram: "峰",
    accent: "#5b7869",
    tint: "#d5e2da",
  },
  {
    id: "xinjiang-grassland-yurts-wide",
    title: "草原毡房与牧场",
    location: "新疆 · 天山草原",
    summary: "宽幅草场、毡房、马匹与远山，适合完整户外人像",
    prompt:
      "场景：图2宽幅草场、黑白毡房、围栏、马匹与远山。移除最右侧白色车辆及金属货架，延续围栏和草地纹理；保留马匹与两座主要毡房。人物置于下部左侧或中部的近景草地，依据围栏和远山尺度确定位置；图1脚部完整时双脚自然落在草地并允许草叶轻遮鞋底，否则采用底边裁切。",
    assetPath: "/background-presets/xinjiang-grassland-yurts-wide.jpeg",
    thumbnailPath: "/background-presets/thumbnails/xinjiang-grassland-yurts-wide.jpeg",
    assetFileName: "xinjiang-grassland-yurts-wide.jpeg",
    monogram: "牧",
    accent: "#75814c",
    tint: "#dce3bd",
  },
  {
    id: "xinjiang-snow-mountain-boardwalk-vertical",
    title: "雪山草原栈道",
    location: "新疆 · 天山雪山草原",
    summary: "雪峰、草原木栈道与开阔近景，适合全身旅行人像",
    prompt:
      "场景：图2雪山群峰、草原、木栈道与远处毡房。移除右下栈道上最靠近镜头的两位游客及其阴影，连续补全木板，其他远处游客可保留。人物优先置于该栈道近处或下部真实泥土地面，依据栈道消失线选择尺度，不照搬原游客动作。保留雪峰轮廓；脚部完整时自然落地，否则底边裁切。",
    assetPath: "/background-presets/xinjiang-snow-mountain-boardwalk-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/xinjiang-snow-mountain-boardwalk-vertical.jpeg",
    assetFileName: "xinjiang-snow-mountain-boardwalk-vertical.jpeg",
    monogram: "雪",
    accent: "#5e758d",
    tint: "#d7e1e9",
  },
  {
    id: "xinjiang-turpan-multilingual-wall-wide",
    title: "吐鲁番多语种文化墙",
    location: "新疆 · 吐鲁番",
    summary: "红色多语种书法墙，适合近距离半身或全身打卡照",
    prompt:
      "场景：图2红色多语种书法文化墙与米色边框。移除右下原男性及其帽子、眼镜、相机、背带、背包和原阴影；新人物优先放在原站位附近并覆盖原遮挡区域，不照搬原动作。保留所有原本可见的白色大字、黄色多语种文字和墙面纹理，不凭空补写被原人物完全遮住的文字；脚部不可完整落地时采用底边裁切。",
    assetPath: "/background-presets/xinjiang-turpan-multilingual-wall-wide.jpeg",
    thumbnailPath: "/background-presets/thumbnails/xinjiang-turpan-multilingual-wall-wide.jpeg",
    assetFileName: "xinjiang-turpan-multilingual-wall-wide.jpeg",
    monogram: "吐",
    accent: "#a54e42",
    tint: "#ebc9bd",
  },
  {
    id: "xinjiang-turpan-grape-valley-book-vertical",
    title: "葡萄沟课本雕塑",
    location: "新疆 · 吐鲁番葡萄沟",
    summary: "巨型语文课本、葡萄装饰与林荫，适合文化打卡照",
    prompt:
      "场景：图2葡萄沟巨型语文课本雕塑、课文插画、葡萄装饰与上方树荫。人物置于画面下部靠侧的镜头前景，采用半身或大半身底边裁切，可遮挡少量书页下角，但保留“葡萄沟”标题、主要课文、插画和葡萄装饰。人物不得站在书页、书脊、石台或葡萄装饰上，不补造地面或台阶。",
    assetPath: "/background-presets/xinjiang-turpan-grape-valley-book-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/xinjiang-turpan-grape-valley-book-vertical.jpeg",
    assetFileName: "xinjiang-turpan-grape-valley-book-vertical.jpeg",
    monogram: "葡",
    accent: "#667b4f",
    tint: "#d9e2ca",
  },
  {
    id: "beijing-summer-palace-kunming-lake-vertical",
    title: "颐和园昆明湖",
    location: "北京 · 颐和园",
    summary: "佛香阁、万寿山与昆明湖纵向远景，适合前景半身人像",
    prompt:
      "场景：图2颐和园佛香阁、万寿山、昆明湖、湖岸建筑与上方松枝。画面没有可见近景站立面，人物只能从下部靠侧的镜头前景以半身或大半身底边裁切出现，不生成完整脚部。保留佛香阁、山体和湖面倒影，允许遮挡少量下部水面；不得把人物放入湖水、游船、屋顶或远处山林，也不补造平台。",
    assetPath: "/background-presets/beijing-summer-palace-kunming-lake-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-summer-palace-kunming-lake-vertical.jpeg",
    assetFileName: "beijing-summer-palace-kunming-lake-vertical.jpeg",
    monogram: "颐",
    accent: "#6c7665",
    tint: "#dce2d7",
  },
  {
    id: "beijing-beihai-white-pagoda-bridge-vertical",
    title: "北海白塔与永安桥",
    location: "北京 · 北海公园",
    summary: "白塔、永安桥与湖面倒影，适合前景半身纪念照",
    prompt:
      "场景：图2北海白塔、琼华岛、永安桥、寺门与湖面倒影。画面没有可见近景站立面，人物只能从下部靠侧的镜头前景以半身或大半身底边裁切出现，不生成脚部。保留白塔、寺门、石桥拱洞和主要倒影，允许遮挡少量下部水面；不得把人物放入湖水、桥栏、桥顶或远处树林，也不补造岸边平台。",
    assetPath: "/background-presets/beijing-beihai-white-pagoda-bridge-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-beihai-white-pagoda-bridge-vertical.jpeg",
    assetFileName: "beijing-beihai-white-pagoda-bridge-vertical.jpeg",
    monogram: "塔",
    accent: "#617f7a",
    tint: "#d5e4df",
  },
  {
    id: "beijing-temple-of-heaven-red-wall-vertical",
    title: "天坛祈年殿 · 红墙",
    location: "北京 · 天坛公园",
    summary: "祈年殿、红墙与开阔石质地面，适合完整旅行人像",
    prompt:
      "场景：图2祈年殿、深蓝琉璃瓦、红墙、左上屋檐、飞鸟与开阔石质地面。清理：移除下部中央原女性及其衣物、随身物品和接触阴影，连续补全红墙与地面，不改写殿额。落位：人物优先放在原站位附近的下部前景，依据墙基与地面透视确定尺度，不照搬原动作，保留祈年殿主体。裁切：图1脚部完整时自然落地，否则从画面底边裁切，不补脚。",
    assetPath: "/background-presets/beijing-temple-of-heaven-red-wall-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-temple-of-heaven-red-wall-vertical.jpeg",
    assetFileName: "beijing-temple-of-heaven-red-wall-vertical.jpeg",
    monogram: "坛",
    accent: "#356b91",
    tint: "#d2e2e8",
  },
  {
    id: "beijing-great-wall-watchtower-vertical",
    title: "长城敌楼近景",
    location: "北京 · 长城",
    summary: "敌楼、城墙步道与山脊纵深，适合近景半身旅行照",
    prompt:
      "场景：图2近处长城城墙、敌楼、蜿蜒山脊与远山。清理：移除右下原男性及其衣物、随身物品和原遮挡，连续补全其后的城砖、台阶与城垛，不删除远处游客。落位：没有清晰可站立地面，新人物只作为镜头前景观景者放在下部靠侧，采用半身或大半身，尺度与原人物相近；不得站到远处城墙、城垛或山体上。裁切：由画面底边自然截出躯干，不生成脚部，保留敌楼和长城走势。",
    assetPath: "/background-presets/beijing-great-wall-watchtower-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-great-wall-watchtower-vertical.jpeg",
    assetFileName: "beijing-great-wall-watchtower-vertical.jpeg",
    monogram: "城",
    accent: "#6b755c",
    tint: "#dce0cf",
  },
  {
    id: "beijing-summer-palace-foxiang-pavilion-lakeside-vertical",
    title: "颐和园佛香阁 · 湖畔",
    location: "北京 · 颐和园",
    summary: "佛香阁、万寿山与昆明湖远景，适合前景半身旅行照",
    prompt:
      "场景：图2颐和园昆明湖、万寿山、佛香阁、沿岸建筑与天空。清理：移除下部中央原男性及眼镜、相机、背带、包和原遮挡，连续补全后方湖水与岸线，保留佛香阁、山体层次和湖面。落位：没有可见近景站立面，新人物只能作为镜头前景放在下部靠侧，采用半身或大半身；不得进入湖水、岸线、树冠或远处建筑。裁切：由画面底边自然截出，不补脚、栏杆或平台。",
    assetPath: "/background-presets/beijing-summer-palace-foxiang-pavilion-lakeside-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-summer-palace-foxiang-pavilion-lakeside-vertical.jpeg",
    assetFileName: "beijing-summer-palace-foxiang-pavilion-lakeside-vertical.jpeg",
    monogram: "颐",
    accent: "#547d8a",
    tint: "#d5e5e8",
  },
  {
    id: "beijing-pku-west-gate-vertical",
    title: "北京大学西校门",
    location: "北京 · 海淀区",
    summary: "传统彩画校门、金字匾额与林荫门洞，适合校园纪念照",
    prompt:
      "场景：图2北京大学西校门的红色门柱、彩画屋檐、蓝底金字匾额、门洞和林荫。清理：移除门洞中央原女性及手提包、原阴影，连续补全门洞内道路；保留现有红色隔离带、立柱和全部建筑文字。落位：人物置于下部中央或稍偏侧的近景地面，避开隔离带与立柱，依据门柱和门洞透视确定尺度，不照搬原动作。裁切：优先四分之三身；脚部完整且不与隔离设施冲突时可全身落地，否则底边裁切。",
    assetPath: "/background-presets/beijing-pku-west-gate-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-pku-west-gate-vertical.jpeg",
    assetFileName: "beijing-pku-west-gate-vertical.jpeg",
    monogram: "北",
    accent: "#9a553b",
    tint: "#ead5c5",
  },
  {
    id: "beijing-tsinghua-university-gate-vertical",
    title: "清华大学校门",
    location: "北京 · 海淀区",
    summary: "石质校门、金色校名与林荫校园，适合完整校园纪念照",
    prompt:
      "场景：图2清华大学石质校门、金色校名、树木、花坛与前景白色栏杆。清理：移除中央原女性、帽子、随身物品和原阴影，补全被遮挡的栏杆、花坛和路面，保持校名文字与门体结构。落位：人物放在栏杆前下部近景的真实地面，依据栏杆和门洞透视确定尺度，不穿入栏杆或花坛。裁切：图1脚部完整时可全身自然落地，否则采用四分之三身或底边裁切。",
    assetPath: "/background-presets/beijing-tsinghua-university-gate-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-tsinghua-university-gate-vertical.jpeg",
    assetFileName: "beijing-tsinghua-university-gate-vertical.jpeg",
    monogram: "清",
    accent: "#687487",
    tint: "#dde1e7",
  },
  {
    id: "beijing-old-summer-palace-ruins-vertical",
    title: "圆明园大水法遗址",
    location: "北京 · 海淀区",
    summary: "石质遗址、木栈道与林地，适合完整历史景观人像",
    prompt:
      "场景：图2圆明园大水法石质遗址、散落石构件、树木、木栈道与绳栏。清理：移除前景原男性及眼镜、衣物和接触阴影，连续补全木栈道与绳栏后的碎石地面，保留遗址结构。落位：新人物优先置于原站位附近的木栈道前景，依据栈道边线和遗址尺度确定位置，不得站入遗址石构件或绳栏后方。裁切：脚部完整时全身自然落在栈道，否则使用底边裁切。",
    assetPath: "/background-presets/beijing-old-summer-palace-ruins-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-old-summer-palace-ruins-vertical.jpeg",
    assetFileName: "beijing-old-summer-palace-ruins-vertical.jpeg",
    monogram: "园",
    accent: "#77705c",
    tint: "#e1ddd1",
  },
  {
    id: "beijing-great-hall-of-people-wide",
    title: "人民大会堂",
    location: "北京 · 西城区",
    summary: "浅色柱廊、开阔道路与金色栏杆，适合前景半身纪念照",
    prompt:
      "场景：使用图2大型公共建筑的浅色柱廊立面、屋顶既有装饰、旗杆、前景道路与金色栏杆；完整保留原有建筑结构和既有背景元素，不改写、放大或新增任何文字与符号。清理：移除下部中央原人物及其服装、随身细节和原遮挡，补全后方道路与建筑。落位：前景没有可见路面，新人物只作为镜头前景放在下部中央或靠侧，位于栏杆这一侧，不得站入道路、栏杆或远处建筑。裁切：使用半身或大半身底边裁切，不生成脚部。",
    assetPath: "/background-presets/beijing-great-hall-of-people-wide.jpeg",
    thumbnailPath: "/background-presets/thumbnails/beijing-great-hall-of-people-wide.jpeg",
    assetFileName: "beijing-great-hall-of-people-wide.jpeg",
    monogram: "堂",
    accent: "#a48a57",
    tint: "#ece2cd",
  },
  {
    id: "paris-arc-de-triomphe-vertical",
    title: "巴黎凯旋门",
    location: "法国 · 巴黎戴高乐广场",
    summary: "凯旋门、复古路灯与石板广场，适合完整城市旅行人像",
    prompt:
      "场景：图2巴黎凯旋门、戴高乐广场石板地面、左侧复古路灯与街牌、远处游客和车辆。清理：图2原人物只用于标记待清理区域，不作为动作或脸部朝向参考；移除该人物及眼镜、挂绳、随身物品和接触阴影，连续补全被遮挡的路灯底座、石板路与背景，不改写街牌。落位：新人物优先放在原站位附近的下部前景，依据路灯、地砖与凯旋门透视确定尺度，但姿势、身体朝向和头部角度完全以图1为准，不模仿图2人物侧脸背靠路灯的动作；图1是正脸就保持正脸，图1是侧脸就保持侧脸。人物不必依靠或接触路灯，不进入车道，保留凯旋门主体。裁切：图1脚部完整时自然落在石板地面，否则从画面底边裁切，不补脚。",
    assetPath: "/background-presets/paris-arc-de-triomphe-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/paris-arc-de-triomphe-vertical.jpeg",
    assetFileName: "paris-arc-de-triomphe-vertical.jpeg",
    monogram: "凯",
    accent: "#6f625b",
    tint: "#e4ddd5",
  },
  {
    id: "giza-pyramids-vertical",
    title: "吉萨金字塔群",
    location: "埃及 · 吉萨高原",
    summary: "金字塔、沙漠与远处驼队，适合开阔的旅行纪念照",
    prompt:
      "场景：图2吉萨金字塔群、前景沙地、浅蓝天空与左下远处驼队。清理：移除右下原男性及帽子、眼镜、披巾、衣物和原遮挡，连续补全其后的金字塔石块、沙地与天空；保留远处驼队。落位：新人物优先放在原人物附近的右下沙地前景，依据沙纹、驼队和金字塔尺度确定距离，不站入金字塔石构或远处驼队。裁切：图1脚部完整时可缩小后自然落在沙地，否则采用四分之三身或底边裁切，不凭空补脚。",
    assetPath: "/background-presets/giza-pyramids-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/giza-pyramids-vertical.jpeg",
    assetFileName: "giza-pyramids-vertical.jpeg",
    monogram: "塔",
    accent: "#9a7952",
    tint: "#ead9bd",
  },
  {
    id: "london-big-ben-westminster-vertical",
    title: "伦敦大本钟与威斯敏斯特桥",
    location: "英国 · 伦敦泰晤士河畔",
    summary: "大本钟、威斯敏斯特桥与泰晤士河，适合前景半身人像",
    prompt:
      "场景：图2大本钟、威斯敏斯特桥、泰晤士河、对岸建筑与阴云天空。清理：移除右下原男性及眼镜、衣物、包和原遮挡，连续补全其后的河面、桥体和石质栏墙，保留桥上远处游客。落位：前景没有可见路面，新人物只能作为栏墙这一侧的镜头前景放在右下或下部靠侧，采用半身或大半身，不得进入河面、桥体或对岸建筑。裁切：由画面底边自然截出躯干，不生成脚部，保留大本钟和主要桥拱。",
    assetPath: "/background-presets/london-big-ben-westminster-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/london-big-ben-westminster-vertical.jpeg",
    assetFileName: "london-big-ben-westminster-vertical.jpeg",
    monogram: "钟",
    accent: "#596574",
    tint: "#d9dfe4",
  },
  {
    id: "new-york-statue-of-liberty-vertical",
    title: "纽约自由女神像",
    location: "美国 · 纽约自由岛",
    summary: "自由女神像、基座与深蓝天空，适合低机位半身纪念照",
    prompt:
      "场景：图2低机位仰拍的自由女神像、石质基座、台阶、金属栏杆与深蓝天空。清理：移除下部中央原男性及眼镜、衣物、手表和原遮挡，连续补全其后的基座、台阶、栏杆与天空；远处小游客可保留。落位：没有清晰可站立地面，新人物只作为栏杆前的镜头前景放在下部中央或靠侧，采用半身或大半身，不得站到基座、台阶、栏杆或雕像上。裁切：由画面底边自然截出躯干，不补脚，完整保留雕像头部、火炬和主要轮廓。",
    assetPath: "/background-presets/new-york-statue-of-liberty-vertical.jpeg",
    thumbnailPath: "/background-presets/thumbnails/new-york-statue-of-liberty-vertical.jpeg",
    assetFileName: "new-york-statue-of-liberty-vertical.jpeg",
    monogram: "自",
    accent: "#397b86",
    tint: "#d0e3e1",
  },
];
