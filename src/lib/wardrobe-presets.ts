import type { ModelId } from "@/lib/catalog";

export const WARDROBE_FEATURE_ENABLED = false;

export type WardrobePreset = {
  id: string;
  title: string;
  era: string;
  summary: string;
  prompt: string;
  recommendedBackgroundIds: string[];
  monogram: string;
  accent: string;
  tint: string;
};

export class WardrobePresetError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "WardrobePresetError";
  }
}

export const WARDROBE_PRESETS: WardrobePreset[] = [
  {
    id: "tang-qixiong-ruqun",
    title: "唐制齐胸襦裙",
    era: "唐制",
    summary: "高腰长裙、短襦与轻盈披帛，明快而舒展",
    prompt:
      "启用服装替换模块：将人物原服装替换为具有可靠结构的唐制齐胸襦裙，以短襦、高束长裙和自然披帛形成完整层次。使用协调而不过度艳俗的传统配色与克制纹样，表现真实丝织物或细密织物的厚度、缝线、褶皱、重力垂坠和行走动态。移除与造型冲突的现代外套、背包和明显现代配饰，但保留人物面部身份、脸型、五官结构、年龄与肤色特征；可为服装垂坠和场景透视适度调整站姿、手臂与身体朝向。不得生成影楼塑料服装、戏服质感、平面贴图或错误穿层。",
    recommendedBackgroundIds: [
      "datong-yungang-grottoes-entrance",
      "datong-yungang-buddha",
    ],
    monogram: "唐",
    accent: "#b9644f",
    tint: "#efd2b7",
  },
  {
    id: "tang-yuanlingpao",
    title: "唐制圆领袍",
    era: "唐制",
    summary: "圆领长袍、腰带与长靴，利落端正",
    prompt:
      "启用服装替换模块：将人物原服装替换为唐制圆领袍造型，以结构清晰的圆领长袍、窄袖或适度宽袖、腰带和协调长靴组成完整穿着。面料呈现真实织物厚度、接缝、褶皱与自然垂坠，配色沉稳并可加入克制的传统纹样。移除冲突的现代外套、背包、肩带和明显现代配饰；人物面部身份、脸型、五官结构、年龄和肤色特征不得发生重大变化。允许为长袍结构、场景透视和自然重心调整身体朝向、站姿和手臂位置，禁止服装漂浮、穿模、左右不对称或像纹理贴在身体上。",
    recommendedBackgroundIds: [
      "datong-yungang-grottoes-entrance",
      "datong-yungang-buddha",
    ],
    monogram: "袍",
    accent: "#8f5443",
    tint: "#dec3ad",
  },
  {
    id: "wei-jin-cross-collar",
    title: "魏晋交领襦裙",
    era: "魏晋风",
    summary: "交领、宽袖与轻柔长裙，清雅飘逸",
    prompt:
      "启用服装替换模块：将人物原服装替换为魏晋审美的交领襦裙或交领长衫，以交领右衽、宽袖、束带和纵向垂坠形成清雅层次。服装应是可真实穿着的织物结构，具有明确领口、肩线、袖口、腰线、内外层关系和自然褶皱，可使用低饱和米白、青绿、灰蓝或赭色。移除冲突的现代外套、背包和肩带；人物面部身份、脸型、五官结构、年龄与肤色不得重大变化。允许为宽袖和衣摆调整站姿、手臂、重心与身体朝向，禁止仙侠影视夸张造型、透明薄纱堆叠、服装穿模或平面贴图感。",
    recommendedBackgroundIds: [
      "datong-yungang-grottoes-entrance",
      "datong-yungang-buddha",
    ],
    monogram: "魏",
    accent: "#647b72",
    tint: "#d5dfd8",
  },
  {
    id: "ming-aoqun",
    title: "明制袄裙",
    era: "明制",
    summary: "立领或交领上袄配马面裙，端庄细致",
    prompt:
      "启用服装替换模块：将人物原服装替换为结构准确、端庄克制的明制袄裙，上身采用立领或交领上袄，下身采用具有清晰褶裥与裙门结构的马面裙，可搭配适量织金或传统纹样。布料必须具有真实厚度、缝线、滚边、褶皱、遮挡和重力垂坠，不得像印花贴图。移除冲突的现代外套、背包、肩带和明显现代配饰；人物面部身份、脸型、五官结构、年龄与肤色特征不得重大变化。允许为裙摆和场景透视调整站姿、手臂动作、身体朝向与画面占比，禁止清代旗装元素、影楼戏服质感、穿模或不合理袖口。",
    recommendedBackgroundIds: [
      "beijing-wumen",
      "beijing-temple-of-heaven",
      "beijing-tiananmen",
    ],
    monogram: "明",
    accent: "#9c3f3f",
    tint: "#ead0c2",
  },
  {
    id: "ming-yuanlingpao",
    title: "明制圆领袍",
    era: "明制",
    summary: "圆领袍、革带与端正廓形，简洁庄重",
    prompt:
      "启用服装替换模块：将人物原服装替换为明制圆领袍造型，以端正圆领、结构清晰的袍身、合宜袖型、革带和协调鞋履构成完整穿着。使用沉稳传统配色和克制纹样，保留真实面料厚度、接缝、袖口、衣摆褶皱与重力垂坠。移除冲突的现代外套、背包、肩带和明显现代配饰；人物面部身份、脸型、五官结构、年龄与肤色特征不得发生重大变化。允许根据建筑透视与袍服结构调整站姿、身体朝向、手臂位置和人物画面占比，禁止清代官服元素、夸张影视戏服、衣物漂浮、穿模或平面粘贴感。",
    recommendedBackgroundIds: [
      "beijing-wumen",
      "beijing-temple-of-heaven",
      "beijing-tiananmen",
    ],
    monogram: "圆",
    accent: "#775047",
    tint: "#dfd0c3",
  },
  {
    id: "qing-princess-style",
    title: "清代宫廷旗装",
    era: "格格风",
    summary: "立领旗装、精细滚边与克制宫廷配饰",
    prompt:
      "启用服装替换模块：将人物原服装替换为具有清代宫廷审美的旗装造型，包括结构清晰的立领、宽袖或氅衣式外层、精细滚边和克制传统纹样，配色与故宫红墙黄瓦协调。可搭配尺度自然的旗头或钿子等发饰，但只能调整被头饰遮挡的局部发型，人物面部身份、脸型、五官结构、年龄和肤色特征不得发生重大变化。服装应呈现真实织物厚度、缝线、层叠、褶皱和重力垂坠；移除冲突的现代外套、背包、肩带与现代首饰。允许为衣袖、衣摆和场景透视调整站姿、手臂位置与身体朝向，禁止混入明制元素、廉价影楼塑料质感、服装穿模或面部被头饰改变。",
    recommendedBackgroundIds: ["beijing-wumen", "beijing-tiananmen"],
    monogram: "清",
    accent: "#8f3d42",
    tint: "#e7c7c8",
  },
];

const WARDROBE_SUBJECT_SAFETY_CONSTRAINT =
  "人物完整性硬约束：先准确统计图1中的核心人物数量，最终前景主体必须与图1一一对应、数量完全相同，每个人只能出现一次。图2中的待替换人物必须先完整移除，不得保留其头部、身体或肢体，也不得把服装预设理解为新增一名展示服装的模特。服装替换只能在图1原人物身体区域内进行，禁止复制人物、叠加第二张身体或同时保留新旧服装。人物头部为身份保护区：脸型、五官结构、眼鼻口位置、年龄和可识别身份不得发生重大变化，只允许匹配环境所必需的曝光、色温和明暗调整，禁止美颜换脸。优先保留图1原姿势；确需适配服装与透视时，只能小幅调整现有肩线、身体朝向和肢体位置，必须以一对一方式重建原有肢体。每个人只能有一颗头、一个躯干、两条手臂和两只手；腿脚仅在画面本应可见时各出现一对。不得从袖口、腰侧或背后长出额外手臂、手掌、手指、腿脚或重复躯干；被遮挡的肢体不要凭空补出。生成结束前必须检查并修正人物数量、面部一致性、手臂数量、手指连接、衣袖与手臂对应关系以及新旧服装残留。";

export function getWardrobePrompt(preset: WardrobePreset) {
  return `${preset.prompt}\n\n${WARDROBE_SUBJECT_SAFETY_CONSTRAINT}`;
}

export function getWardrobePreset(id: string | undefined) {
  if (!id) return undefined;
  return WARDROBE_PRESETS.find((preset) => preset.id === id);
}

export function resolveWardrobePreset(
  modelId: ModelId,
  wardrobePresetId: string | undefined,
) {
  if (!wardrobePresetId) return undefined;
  if (!WARDROBE_FEATURE_ENABLED) {
    throw new WardrobePresetError("服装替换功能暂未开放");
  }
  if (modelId !== "background-replace") {
    throw new WardrobePresetError("服装替换模块仅支持背景替换模式");
  }

  const preset = getWardrobePreset(wardrobePresetId);
  if (!preset) throw new WardrobePresetError("选择的服装预设不存在");
  return preset;
}
