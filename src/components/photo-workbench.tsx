"use client";

import {
    ARK_SETTINGS_STORAGE_KEY,
    ArkClientSettings,
    createArkRequestHeaders,
    DEFAULT_ARK_CLIENT_SETTINGS,
} from "@/lib/ark-client-config";
import {
    BACKGROUND_PRESETS,
    BackgroundPreset,
    GENERAL_BACKGROUND_PRESET_ID,
    getBackgroundPlacementProfile,
    getBackgroundPresetPrompt,
    isGeneralBackgroundPreset,
} from "@/lib/background-presets";
import { buildBackgroundReplacePrompt } from "@/lib/background-replace-prompt";
import {
    getPromptMaxLength,
    isBackgroundReplaceModel,
    isBatchModel,
    isUserPromptOnlyModel,
    ModelId,
    MODELS,
    supportsCreativeGuidance,
} from "@/lib/catalog";
import {
    GENERAL_BACKGROUND_REPLACE_PROMPT,
    GENERAL_BACKGROUND_REPLACE_PROMPT_MAX_LENGTH,
} from "@/lib/general-background-replace-prompt";
import {
    ACCEPTED_IMAGE_TYPES,
    getImageValidationError,
    MAX_BATCH_IMAGES,
} from "@/lib/image-processing-limits";
import {
    GenerationHistoryItem,
    GenerationHistoryListResponse,
} from "@/lib/generation-history-types";
import {
    GenerationTask,
    GenerationTaskListResponse,
    GenerationTaskStatus,
    isActiveGenerationTask,
} from "@/lib/generation-task-types";
import { ProviderSettingsView } from "@/lib/provider-settings-types";
import { SkillMetadata } from "@/lib/skill-types";
import {
    getWardrobePreset,
    getWardrobePrompt,
    WARDROBE_FEATURE_ENABLED,
    WARDROBE_PRESETS,
} from "@/lib/wardrobe-presets";
import {
    ArrowDownToLine,
    AtSign,
    Check,
    Eye,
    EyeOff,
    FileUp,
    History as HistoryIcon,
    ImagePlus,
    KeyRound,
    Pencil,
    RefreshCw,
    RotateCcw,
    ServerCog,
    Settings,
    Share2,
    ShieldCheck,
    Shirt,
    Sparkles,
    Trash2,
    Upload,
    WandSparkles,
    X,
} from "lucide-react";
import Link from "next/link";
import {
    ChangeEvent,
    DragEvent,
    KeyboardEvent,
    SyntheticEvent,
    useEffect,
    useRef,
    useState,
} from "react";

const DISABLED_SKILLS_STORAGE_KEY = "photo-playground-disabled-skills";
const BACKGROUND_GRADE_ORDER = { A: 0, B: 1, C: 2 } as const;

type Status = "empty" | "ready" | "processing" | "complete";

type SourceImage = {
  id: string;
  file: File;
  previewUrl: string;
};

type ProcessResultItem = {
  sourceId: string;
  fileName: string;
  status: "processing" | "complete" | "error";
  imageUrl?: string;
  providerModel?: string;
  size?: string;
  historyItem?: GenerationHistoryItem;
  error?: string;
};

type CompletionNotice = {
  message: string;
  canOpenHistory: boolean;
  historyItemId?: string;
};

type WorkbenchCopy = {
  mainImageLabel: string;
  referenceImageLabel: string;
  headerTitle: string;
  eyebrow: string;
  headingTitle: string;
  headingSubtitle: string;
  placeholderText: string;
  generateButtonText: string;
  processingText: string;
  processingSubText: string;
  completionToast: string;
  missingUploadText: string;
};

type PromptPreset = {
  id: string;
  title: string;
  summary: string;
  prompt: string;
  appendReferenceBoundary?: boolean;
};

type BackgroundPresetEditDraft = {
  id: string;
  title: string;
  location: string;
  summary: string;
  prompt: string;
  image: File | null;
  previewUrl: string;
};

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatHistoryBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function fetchGenerationHistory(): Promise<GenerationHistoryListResponse> {
  const response = await fetch("/api/history", { cache: "no-store" });
  const result = (await response.json()) as GenerationHistoryListResponse & {
    error?: string;
  };
  if (!response.ok || !Array.isArray(result.items)) {
    throw new Error(result.error ?? "历史记录读取失败");
  }
  return result;
}

async function fetchGenerationTasks(): Promise<GenerationTaskListResponse> {
  const response = await fetch("/api/generation-tasks", { cache: "no-store" });
  const result = (await response.json()) as GenerationTaskListResponse & {
    error?: string;
  };
  if (!response.ok || !Array.isArray(result.tasks)) {
    throw new Error(result.error ?? "后台任务读取失败");
  }
  return result;
}

function formatTaskTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getTaskStatusLabel(status: GenerationTaskStatus) {
  if (status === "queued") return "等待中";
  if (status === "processing") return "生成中";
  if (status === "completed") return "已完成";
  if (status === "partial") return "部分完成";
  return "失败";
}

const FLAT_PAPER_CUT_PROMPT_PRESETS: PromptPreset[] = [
  {
    id: "fresh-storybook",
    title: "清新治愈",
    summary: "暖白纸张、大量留白与小幅手绘插画",
    prompt: `请将我上传的每张照片分别制作成一张独立的艺术海报，海报严格对齐参考图的长宽比例。不要拼图，不要保留或还原原始照片区域。整张画面都采用风格化手绘插画表现。
以 暖白色粗糙纸张 作为整体背景，画面保持大量留白。提取照片中最有辨识度的人物、物体、姿态、位置关系和互动氛围，将其转化为一幅小巧、安静的手绘插画，主体占画面约 15%–30%，可放置在画面中下部或视觉上自然的位置，四周保留宽阔空白。
使用 纤细、略不稳定的手绘线条，搭配不超过 4 种取自原照片的丙烯平涂色块。保留手工颗粒感、不规则笔触和纸张纹理，整体应有独立艺术书、手工小画册、轻松童趣的质感。
可以加入一句贴合照片氛围的 小号英文标题，排版克制、低调，不喧宾夺主。
整体风格安静、轻松、有童趣和独立艺术书气质。避免写实复制、照片拼贴、水彩晕染、蜡笔质感、3D 效果、商业卡通风、复杂背景、过度装饰和水印。每张照片单独生成一张完整海报。`,
    appendReferenceBoundary: false,
  },
  {
    id: "folk-retro",
    title: "复古民艺",
    summary: "高对比有限色盘、手剪轮廓与克制镂空纹样",
    prompt: `请帮我生成图片：竖向2：3构图，画面水平对半50/50分割，上下两个独立区域，边界清晰互不交融。
上半部分100%完整保留用户上传的实拍原图，严格保留原图的物体、人物、姿态、环境、光影、色彩和全部细节，不得重绘、变形、美化；仅允许为了适配画幅进行少量等比例裁切或自然延展。
分析原图，选择一个最适合延伸的真实元素，例如海水、道路、绳索、缆线、光线、桥梁、码头、树枝、山坡、建筑轮廓、系船柱或倒影。这个元素必须从照片中的准确位置连续穿过画面中线，逐渐从真实摄影质感转化为简洁黑色线稿，并与下半部分的小人物产生明确互动。连接中间不能出现空隙、错位或重新起笔，不能让线稿人物和主图互不相关。`,
    appendReferenceBoundary: false,
  },
  {
    id: "modern-editorial",
    title: "现代编辑",
    summary: "极简几何、清晰负空间与高饱和视觉重心",
    prompt: `将旅行照片制作成独立的3:4竖版「实景延伸线稿旅行海报」，每张单独生成，不拼图、不合集。

上下严格50%:50%，正中水平分界。

上半部分完整保留原照片真实质感、主体、构图、色彩和自然光影。不要重绘、插画化或改变主体，仅允许少量裁剪和自然延展背景，禁止拉伸扭曲。

下半部分为温暖米白色细腻纸张。从照片底部的山、海、灯塔、夕阳、盐湖、海鸥等主要元素自然延伸到纸面，将其轮廓、结构和线条转化为黑色极简手绘线稿，继续向下延伸。

加入少量浅色透明水彩晕染，轻盈、有空气感，不要厚重色块。

加入1-3个很小的黑色极简线稿小人，动作自然有趣，至少1个与主体互动。小人不要写实、复杂或抢主体。

生成一句简短自然的英文手写旅行短句，黑色手写字，不要鸡汤或广告语。

整体风格：高级旅行杂志、艺术摄影海报、极简手记；精致、松弛、克制、轻盈、有留白。

核心视觉：
「照片记录现实，线稿延伸想象。」`,
    appendReferenceBoundary: false,
  },
];

function getFlatPaperCutPresetPrompt(
  preset: PromptPreset,
  hasReferenceImage: boolean,
) {
  if (!hasReferenceImage || preset.appendReferenceBoundary === false) {
    return preset.prompt;
  }

  return `${preset.prompt} 图1是唯一的内容事实；图2只参考配色和剪纸造型，不复制图2中的人物、物体、文字或构图。`;
}

const WORKBENCH_COPY: Record<ModelId, WorkbenchCopy> = {
  "paper-collage-poster": {
    mainImageLabel: "主图",
    referenceImageLabel: "参考图",
    headerTitle: "Paper Collage 拼贴海报",
    eyebrow: "PAPER COLLAGE STUDIO",
    headingTitle: "把照片，变成拼贴海报",
    headingSubtitle: "一次上传最多 10 张主图，共用同一提示词并行生成独立的纸张拼贴作品。",
    placeholderText: "例如：@图1 旅行手账风格，撕纸开窗，复古纸张纹理...",
    generateButtonText: "生成海报",
    processingText: "方舟正在并行生成拼贴海报",
    processingSubText: "Paper Collage 批量处理中",
    completionToast: "拼贴海报批量生成完成",
    missingUploadText: "先上传主图",
  },
  "flat-paper-cut-cartoon": {
    mainImageLabel: "原图",
    referenceImageLabel: "风格参考图",
    headerTitle: "平面剪纸卡通 · 自定义提示",
    eyebrow: "FLAT PAPER-CUT CARTOON",
    headingTitle: "用自己的提示词，控制整张图的剪纸卡通化",
    headingSubtitle: "一次上传最多 10 张原图；同一提示词会原样用于每张图片，并在服务端并行处理。",
    placeholderText: "请完整描述人物与背景如何转化；有图2时请明确：图1是内容，图2只参考配色与剪纸造型...",
    generateButtonText: "生成剪纸卡通",
    processingText: "方舟正在并行生成剪纸卡通",
    processingSubText: "Flat Paper-Cut Cartoon 批量处理中",
    completionToast: "剪纸卡通批量生成完成",
    missingUploadText: "先上传原图",
  },
  "background-replace": {
    mainImageLabel: "主体图",
    referenceImageLabel: "背景参考图",
    headerTitle: "背景替换",
    eyebrow: "BACKGROUND REPLACE",
    headingTitle: "把主体，融入新背景",
    headingSubtitle: "上传主体照片和背景参考图；系统锁定原面容与姿势，并约束光线、尺度和透视。",
    placeholderText: "只需描述目标场景、人物落位、裁切和待移除内容；身份、光线与透视由系统保护...",
    generateButtonText: "替换背景",
    processingText: "方舟正在替换背景",
    processingSubText: "Background Replace 模式处理中",
    completionToast: "背景替换完成",
    missingUploadText: "请上传主体图和背景图",
  },
};

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function fetchAvailableSkills(): Promise<SkillMetadata[]> {
  const response = await fetch("/api/skills", { cache: "no-store" });
  const result = (await response.json()) as {
    skills?: SkillMetadata[];
    error?: string;
  };
  if (!response.ok || !result.skills) {
    throw new Error(result.error ?? "Skill 列表加载失败");
  }
  return result.skills;
}

async function fetchBackgroundPresetCatalog(): Promise<BackgroundPreset[]> {
  const response = await fetch("/api/background-presets", { cache: "no-store" });
  const result = (await response.json()) as {
    presets?: BackgroundPreset[];
    error?: string;
  };
  if (!response.ok || !Array.isArray(result.presets)) {
    throw new Error(result.error ?? "候选背景读取失败");
  }
  return result.presets;
}

async function fetchImageProviderStatus(): Promise<ProviderSettingsView> {
  const response = await fetch("/api/provider-status", { cache: "no-store" });
  const result = (await response.json()) as ProviderSettingsView & {
    error?: string;
  };
  if (!response.ok) throw new Error(result.error ?? "图片服务状态读取失败");
  return result;
}

export function PhotoWorkbench() {
  const inputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const skillFileRef = useRef<HTMLInputElement>(null);
  const sourceImagesRef = useRef<SourceImage[]>([]);
  const taskStatusesRef = useRef(new Map<string, GenerationTaskStatus>());
  const taskPollingInitializedRef = useRef(false);
  const [sourceImages, setSourceImages] = useState<SourceImage[]>([]);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [isReferenceOnTop, setIsReferenceOnTop] = useState(false);
  const [processResults, setProcessResults] = useState<ProcessResultItem[]>([]);
  const [status, setStatus] = useState<Status>("empty");
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const [generationTasks, setGenerationTasks] = useState<GenerationTask[]>([]);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [completionNotice, setCompletionNotice] =
    useState<CompletionNotice | null>(null);
  const [prompt, setPrompt] = useState("");
  const [strength, setStrength] = useState(72);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<ModelId>("paper-collage-poster");
  const [arkSettings, setArkSettings] = useState<ArkClientSettings>(
    DEFAULT_ARK_CLIENT_SETTINGS,
  );
  const [settingsDraft, setSettingsDraft] = useState<ArkClientSettings>(
    DEFAULT_ARK_CLIENT_SETTINGS,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rememberSettings, setRememberSettings] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [disabledSkillNames, setDisabledSkillNames] = useState<string[]>([]);
  const [disabledSkillsLoaded, setDisabledSkillsLoaded] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [isImportingSkill, setIsImportingSkill] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<GenerationHistoryItem[]>([]);
  const [historyLimit, setHistoryLimit] = useState(100);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [selectedBackgroundPresetId, setSelectedBackgroundPresetId] = useState<string | null>(null);
  const [backgroundPromptIsComposed, setBackgroundPromptIsComposed] = useState(false);
  const [backgroundPresets, setBackgroundPresets] = useState<BackgroundPreset[]>(
    BACKGROUND_PRESETS,
  );
  const [loadingBackgroundPresetId, setLoadingBackgroundPresetId] = useState<string | null>(null);
  const [backgroundPresetAvailability, setBackgroundPresetAvailability] = useState<Record<string, boolean>>({});
  const [backgroundPresetEditDraft, setBackgroundPresetEditDraft] =
    useState<BackgroundPresetEditDraft | null>(null);
  const [isSavingBackgroundPreset, setIsSavingBackgroundPreset] = useState(false);
  const [selectedWardrobePresetId, setSelectedWardrobePresetId] = useState<string | null>(null);
  const [imageProviderStatus, setImageProviderStatus] =
    useState<ProviderSettingsView | null>(null);

  const isBackgroundReplace = selectedModelId === "background-replace";
  const isBackgroundReplaceMode = isBackgroundReplaceModel(selectedModelId);
  const usesGeneralBackgroundPrompt =
    isBackgroundReplace && isGeneralBackgroundPreset(selectedBackgroundPresetId);
  const isFlatPaperCut = selectedModelId === "flat-paper-cut-cartoon";
  const isBatchMode = isBatchModel(selectedModelId);
  const isUserPromptOnly = isUserPromptOnlyModel(selectedModelId);
  const supportsGuidance = supportsCreativeGuidance(selectedModelId);
  const promptMaxLength = usesGeneralBackgroundPrompt
    ? GENERAL_BACKGROUND_REPLACE_PROMPT_MAX_LENGTH
    : getPromptMaxLength(selectedModelId);
  const modeCopy = WORKBENCH_COPY[selectedModelId];
  const usesLovart =
    isBackgroundReplaceMode &&
    imageProviderStatus?.backgroundReplaceProvider === "lovart";
  const usesYouPai =
    isBackgroundReplaceMode &&
    imageProviderStatus?.backgroundReplaceProvider === "youpai";
  const usesApiModels =
    isBackgroundReplaceMode &&
    imageProviderStatus?.backgroundReplaceProvider === "apimodels";
  const file = sourceImages[0]?.file ?? null;
  const sourceUrl = sourceImages[0]?.previewUrl ?? "";
  const successfulResults = processResults.filter(
    (result) => result.status === "complete" && result.imageUrl,
  );
  const resultUrl = successfulResults[0]?.imageUrl ?? "";
  const activeGenerationTasks = generationTasks.filter(isActiveGenerationTask);
  const hasBrowserConfig = Boolean(arkSettings.apiKey);
  const hasConfiguredProvider =
    hasBrowserConfig ||
    Boolean(imageProviderStatus?.youpaiConfigured) ||
    Boolean(imageProviderStatus?.apiModelsConfigured);
  const availableSkillNameSet = new Set(skills.map((skill) => skill.name));
  const activeDisabledSkillNames =
    skills.length > 0
      ? disabledSkillNames.filter((name) => availableSkillNameSet.has(name))
      : disabledSkillNames;
  const disabledSkillSet = new Set(activeDisabledSkillNames);
  const selectedBackgroundPreset = backgroundPresets.find(
    (preset) => preset.id === selectedBackgroundPresetId,
  );
  const orderedBackgroundPresets = [...backgroundPresets].sort(
    (left, right) => {
      if (isGeneralBackgroundPreset(left)) return -1;
      if (isGeneralBackgroundPreset(right)) return 1;
      return (
        BACKGROUND_GRADE_ORDER[getBackgroundPlacementProfile(left).grade] -
        BACKGROUND_GRADE_ORDER[getBackgroundPlacementProfile(right).grade]
      );
    },
  );
  const selectedHistoryItem =
    historyItems.find((item) => item.id === selectedHistoryId) ??
    historyItems[0] ??
    null;
  const selectedWardrobePreset = getWardrobePreset(
    selectedWardrobePresetId ?? undefined,
  );
  const wardrobeOptions = [...WARDROBE_PRESETS].sort((left, right) => {
    const backgroundId = selectedBackgroundPresetId ?? "";
    return (
      Number(right.recommendedBackgroundIds.includes(backgroundId)) -
      Number(left.recommendedBackgroundIds.includes(backgroundId))
    );
  });

  // Build the combined menu items: skills + image refs
  const imageRefItems: Array<{ id: string; label: string; desc: string }> = [];
  if (file) {
    imageRefItems.push({
      id: "图1",
      label: "图1",
      desc: isBackgroundReplaceMode
        ? "引用主体图"
        : "引用批处理中当前这一张主图",
    });
  }
  if (referenceFile) {
    imageRefItems.push({
      id: "图2",
      label: "图2",
      desc: isBackgroundReplaceMode ? "引用背景参考图" : "引用已上传的参考图",
    });
  }

  const filteredSkills = !supportsGuidance
    ? []
    : skills
        .filter((skill) => {
          const query = skillQuery.toLowerCase();
          return (
            !query ||
            skill.name.includes(query) ||
            skill.description.toLowerCase().includes(query)
          );
        })
        .slice(0, 6);

  const filteredImageRefs = imageRefItems.filter((ref) => {
    const query = skillQuery.toLowerCase();
    return !query || ref.id.toLowerCase().includes(query);
  });

  const hasMenuItems = filteredSkills.length > 0 || filteredImageRefs.length > 0;
  const mentionItemCount =
    (supportsGuidance ? skills.length : 0) + imageRefItems.length;

  const firstEnabledFilteredSkill = filteredSkills.find(
    (skill) => !disabledSkillSet.has(skill.name),
  );

  useEffect(() => {
    sourceImagesRef.current = sourceImages;
  }, [sourceImages]);

  useEffect(() => {
    return () => {
      sourceImagesRef.current.forEach((source) => {
        URL.revokeObjectURL(source.previewUrl);
      });
    };
  }, []);

  useEffect(() => {
    return () => {
      if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    };
  }, [referenceUrl]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;

    async function pollTasks() {
      try {
        const result = await fetchGenerationTasks();
        if (cancelled) return;

        const newlyFinished = taskPollingInitializedRef.current
          ? result.tasks.filter((task) => {
              const previous = taskStatusesRef.current.get(task.id);
              return (
                (previous === "queued" || previous === "processing") &&
                !isActiveGenerationTask(task)
              );
            })
          : [];

        taskStatusesRef.current = new Map(
          result.tasks.map((task) => [task.id, task.status]),
        );
        taskPollingInitializedRef.current = true;
        setGenerationTasks(result.tasks);

        if (newlyFinished.length === 0) return;
        const successfulTasks = newlyFinished.filter(
          (task) => task.succeeded > 0,
        );
        if (successfulTasks.length > 0) {
          const succeeded = successfulTasks.reduce(
            (total, task) => total + task.succeeded,
            0,
          );
          const latest = successfulTasks[0];
          setCompletionNotice({
            message:
              newlyFinished.length === 1
                ? `${succeeded} 个生成结果已完成并保存到历史任务`
                : `${successfulTasks.length} 个后台任务已完成，共保存 ${succeeded} 个结果`,
            canOpenHistory: true,
            historyItemId: latest.latestHistoryItemId,
          });
          void fetchGenerationHistory()
            .then((history) => {
              if (cancelled) return;
              setHistoryItems(history.items);
              setHistoryLimit(history.limit);
            })
            .catch(() => undefined);
          return;
        }

        setCompletionNotice({
          message:
            newlyFinished.length === 1
              ? "后台生成任务失败，可打开任务面板查看原因"
              : `${newlyFinished.length} 个后台生成任务失败`,
          canOpenHistory: false,
        });
      } catch {
        // A transient polling failure should not interrupt the editing flow.
      }
    }

    void pollTasks();
    const timer = window.setInterval(() => void pollTasks(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    function parseSettings(raw: string | null): ArkClientSettings | null {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<ArkClientSettings>;
        if (
          typeof parsed.apiKey !== "string" ||
          typeof parsed.imageModel !== "string"
        ) {
          return null;
        }
        return {
          apiKey: parsed.apiKey,
          imageModel: parsed.imageModel,
        };
      } catch {
        return null;
      }
    }

    const persistent = parseSettings(
      window.localStorage.getItem(ARK_SETTINGS_STORAGE_KEY),
    );
    const session = parseSettings(
      window.sessionStorage.getItem(ARK_SETTINGS_STORAGE_KEY),
    );
    const stored = persistent ?? session;
    if (stored) {
      const timer = window.setTimeout(() => {
        setArkSettings(stored);
        setSettingsDraft(stored);
        setRememberSettings(Boolean(persistent));
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!settingsOpen && !historyOpen && !backgroundPresetEditDraft) return;
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setHistoryOpen(false);
        if (backgroundPresetEditDraft?.image) {
          URL.revokeObjectURL(backgroundPresetEditDraft.previewUrl);
        }
        setBackgroundPresetEditDraft(null);
        setIsSavingBackgroundPreset(false);
      }
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [backgroundPresetEditDraft, historyOpen, settingsOpen]);

  useEffect(() => {
    let cancelled = false;
    void fetchAvailableSkills()
      .then((availableSkills) => {
        if (!cancelled) setSkills(availableSkills);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchBackgroundPresetCatalog()
      .then((presets) => {
        if (!cancelled) setBackgroundPresets(presets);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchImageProviderStatus()
      .then((status) => {
        if (!cancelled) setImageProviderStatus(status);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchGenerationHistory()
      .then((result) => {
        if (cancelled) return;
        setHistoryItems(result.items);
        setHistoryLimit(result.limit);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const parsed = JSON.parse(
          window.localStorage.getItem(DISABLED_SKILLS_STORAGE_KEY) ?? "[]",
        ) as unknown;
        setDisabledSkillNames(
          Array.isArray(parsed)
            ? parsed.filter((name): name is string => typeof name === "string")
            : [],
        );
      } catch {
        setDisabledSkillNames([]);
      } finally {
        setDisabledSkillsLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!disabledSkillsLoaded) return;
    window.localStorage.setItem(
      DISABLED_SKILLS_STORAGE_KEY,
      JSON.stringify(disabledSkillNames),
    );
  }, [disabledSkillNames, disabledSkillsLoaded]);

  function openSettings() {
    setHistoryOpen(false);
    setSettingsDraft(arkSettings);
    setSettingsError("");
    setShowApiKey(false);
    setSettingsOpen(true);
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const result = await fetchGenerationHistory();
      setHistoryItems(result.items);
      setHistoryLimit(result.limit);
      setSelectedHistoryId((current) =>
        current && result.items.some((item) => item.id === current)
          ? current
          : (result.items[0]?.id ?? null),
      );
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : "历史记录读取失败");
    } finally {
      setHistoryLoading(false);
    }
  }

  function openHistory() {
    setSettingsOpen(false);
    setTaskPanelOpen(false);
    setHistoryOpen(true);
    void loadHistory();
  }

  function openCompletedTaskHistory() {
    if (completionNotice?.historyItemId) {
      setSelectedHistoryId(completionNotice.historyItemId);
    }
    setCompletionNotice(null);
    openHistory();
  }

  function selectWardrobePreset(wardrobePresetId: string | null) {
    setSelectedWardrobePresetId(wardrobePresetId);
    setProcessResults([]);
    setStatus(file ? "ready" : "empty");
    setError("");
    const preset = getWardrobePreset(wardrobePresetId ?? undefined);
    setToast(preset ? `已启用服装积木：${preset.title}` : "将保持人物原服装");
  }

  function saveSettings(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSettings = {
      apiKey: settingsDraft.apiKey.trim(),
      imageModel: settingsDraft.imageModel.trim(),
    };

    if (!nextSettings.apiKey) {
      setSettingsError("请输入火山方舟 API Key");
      return;
    }
    if (nextSettings.apiKey.length > 512) {
      setSettingsError("API Key 长度不能超过 512 个字符");
      return;
    }
    if (!nextSettings.imageModel) {
      setSettingsError("请填写图片模型");
      return;
    }
    if (nextSettings.imageModel.length > 128) {
      setSettingsError("模型 ID 不能超过 128 个字符");
      return;
    }

    window.localStorage.removeItem(ARK_SETTINGS_STORAGE_KEY);
    window.sessionStorage.removeItem(ARK_SETTINGS_STORAGE_KEY);
    const storage = rememberSettings
      ? window.localStorage
      : window.sessionStorage;
    storage.setItem(ARK_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
    setArkSettings(nextSettings);
    setSettingsOpen(false);
    setToast("方舟 API 配置已保存");
  }

  function clearSettings() {
    window.localStorage.removeItem(ARK_SETTINGS_STORAGE_KEY);
    window.sessionStorage.removeItem(ARK_SETTINGS_STORAGE_KEY);
    setArkSettings(DEFAULT_ARK_CLIENT_SETTINGS);
    setSettingsDraft(DEFAULT_ARK_CLIENT_SETTINGS);
    setRememberSettings(false);
    setSettingsOpen(false);
    setToast("已清除浏览器配置，将使用服务端配置");
  }

  function acceptFiles(nextFiles: File[]) {
    setError("");
    if (nextFiles.length === 0) return;

    const validFiles: File[] = [];
    const validationErrors: string[] = [];
    nextFiles.forEach((nextFile, index) => {
      const validationError = getImageValidationError(
        nextFile,
        `第 ${index + 1} 张图片`,
      );
      if (validationError) {
        validationErrors.push(validationError);
      } else {
        validFiles.push(nextFile);
      }
    });
    if (validFiles.length === 0) {
      setError(validationErrors[0] ?? "请选择有效图片");
      return;
    }

    if (isBatchMode) {
      const availableSlots = Math.max(
        0,
        MAX_BATCH_IMAGES - sourceImages.length,
      );
      const acceptedFiles = validFiles.slice(0, availableSlots);
      if (acceptedFiles.length > 0) {
        setSourceImages((current) => [
          ...current,
          ...acceptedFiles.map((acceptedFile) => ({
            id: crypto.randomUUID(),
            file: acceptedFile,
            previewUrl: URL.createObjectURL(acceptedFile),
          })),
        ]);
      }
      if (validFiles.length > availableSlots) {
        validationErrors.push(`每批最多上传 ${MAX_BATCH_IMAGES} 张主图`);
      }
    } else {
      sourceImages.forEach((source) => URL.revokeObjectURL(source.previewUrl));
      const acceptedFile = validFiles[0];
      setSourceImages([
        {
          id: crypto.randomUUID(),
          file: acceptedFile,
          previewUrl: URL.createObjectURL(acceptedFile),
        },
      ]);
      if (validFiles.length > 1) {
        validationErrors.push("背景替换模式一次只支持一张主体图");
      }
    }

    setProcessResults([]);
    setIsReferenceOnTop(false);
    setStatus("ready");
    if (validationErrors.length > 0) {
      setError(validationErrors[0]);
    }
  }

  function removeSourceImage(sourceId: string) {
    const target = sourceImages.find((source) => source.id === sourceId);
    if (target) URL.revokeObjectURL(target.previewUrl);
    const nextImages = sourceImages.filter((source) => source.id !== sourceId);
    setSourceImages(nextImages);
    setProcessResults([]);
    setStatus(nextImages.length > 0 ? "ready" : "empty");
  }

  function clearSourceImages() {
    sourceImages.forEach((source) => URL.revokeObjectURL(source.previewUrl));
    setSourceImages([]);
    setProcessResults([]);
    setStatus("empty");
  }

  function acceptReferenceFile(
    nextFile: File | undefined,
    backgroundPresetId: string | null = null,
  ) {
    setError("");
    if (!nextFile) return false;
    const validationError = getImageValidationError(nextFile, "参考图");
    if (validationError) {
      setError(validationError);
      return false;
    }

    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    setReferenceFile(nextFile);
    setReferenceUrl(URL.createObjectURL(nextFile));
    setSelectedBackgroundPresetId(backgroundPresetId);
    setIsReferenceOnTop(false);
    setProcessResults([]);
    setStatus(sourceImages.length > 0 ? "ready" : "empty");
    return true;
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    acceptFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleReferenceInput(event: ChangeEvent<HTMLInputElement>) {
    acceptReferenceFile(
      event.target.files?.[0],
      usesGeneralBackgroundPrompt ? GENERAL_BACKGROUND_PRESET_ID : null,
    );
    event.target.value = "";
  }

  function applyBackgroundPresetPrompt(preset: BackgroundPreset) {
    const isGeneralPreset = isGeneralBackgroundPreset(preset);
    const maxLength = isGeneralPreset
      ? GENERAL_BACKGROUND_REPLACE_PROMPT_MAX_LENGTH
      : getPromptMaxLength("background-replace");
    const visiblePrompt = isGeneralPreset
      ? getBackgroundPresetPrompt(preset)
      : buildBackgroundReplacePrompt(getBackgroundPresetPrompt(preset));
    setPrompt(visiblePrompt.slice(0, maxLength));
    setBackgroundPromptIsComposed(!isGeneralPreset);
    setSkillMenuOpen(false);
    setSkillQuery("");
    setError("");
  }

  async function applyBackgroundPreset(preset: BackgroundPreset) {
    if (status === "processing" || loadingBackgroundPresetId) return;

    if (isGeneralBackgroundPreset(preset)) {
      const referenceCameFromAnotherPreset = Boolean(
        selectedBackgroundPresetId &&
        selectedBackgroundPresetId !== GENERAL_BACKGROUND_PRESET_ID,
      );
      if (referenceCameFromAnotherPreset) {
        if (referenceUrl) URL.revokeObjectURL(referenceUrl);
        setReferenceFile(null);
        setReferenceUrl("");
      }
      setSelectedBackgroundPresetId(GENERAL_BACKGROUND_PRESET_ID);
      setSelectedWardrobePresetId(null);
      applyBackgroundPresetPrompt(preset);
      setProcessResults([]);
      setStatus(sourceImages.length > 0 ? "ready" : "empty");
      setToast("已启用通用模式；请上传自己的目标背景图");
      return;
    }

    if (backgroundPresetAvailability[preset.id] === false) {
      setToast(`「${preset.title}」背景素材待上传，当前背景和提示词未更改`);
      return;
    }

    setLoadingBackgroundPresetId(preset.id);
    try {
      if (!preset.assetPath || !preset.assetFileName) {
        throw new Error("preset-asset-missing");
      }
      const response = await fetch(preset.assetPath, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("preset-asset-missing");
      }

      const blob = await response.blob();
      const presetFile = new File([blob], preset.assetFileName, {
        type: blob.type || "image/jpeg",
      });
      if (!acceptReferenceFile(presetFile, preset.id)) return;

      applyBackgroundPresetPrompt(preset);
      setBackgroundPresetAvailability((current) => ({
        ...current,
        [preset.id]: true,
      }));
      setToast(`已选用「${preset.title}」背景并填入完整提示词`);
    } catch {
      setBackgroundPresetAvailability((current) => ({
        ...current,
        [preset.id]: false,
      }));
      setToast(`「${preset.title}」背景素材待上传，当前背景和提示词未更改`);
    } finally {
      setLoadingBackgroundPresetId(null);
    }
  }

  function openBackgroundPresetEditor(preset: BackgroundPreset) {
    if (isGeneralBackgroundPreset(preset)) return;
    setBackgroundPresetEditDraft({
      id: preset.id,
      title: preset.title,
      location: preset.location,
      summary: preset.summary,
      prompt: preset.prompt,
      image: null,
      previewUrl: preset.thumbnailPath ?? "",
    });
    setError("");
  }

  function closeBackgroundPresetEditor() {
    if (backgroundPresetEditDraft?.image) {
      URL.revokeObjectURL(backgroundPresetEditDraft.previewUrl);
    }
    setBackgroundPresetEditDraft(null);
    setIsSavingBackgroundPreset(false);
    setError("");
  }

  function handleBackgroundPresetImage(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0];
    event.target.value = "";
    if (!image || !backgroundPresetEditDraft) return;
    const validationError = getImageValidationError(image, "背景参考图");
    if (validationError) {
      setError(validationError);
      return;
    }
    if (backgroundPresetEditDraft.image) {
      URL.revokeObjectURL(backgroundPresetEditDraft.previewUrl);
    }
    setBackgroundPresetEditDraft((current) =>
      current
        ? { ...current, image, previewUrl: URL.createObjectURL(image) }
        : current,
    );
    setError("");
  }

  async function saveBackgroundPresetEdit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!backgroundPresetEditDraft || isSavingBackgroundPreset) return;
    setIsSavingBackgroundPreset(true);
    setError("");
    try {
      const form = new FormData();
      form.set("title", backgroundPresetEditDraft.title);
      form.set("location", backgroundPresetEditDraft.location);
      form.set("summary", backgroundPresetEditDraft.summary);
      form.set("prompt", backgroundPresetEditDraft.prompt);
      if (backgroundPresetEditDraft.image) {
        form.set("image", backgroundPresetEditDraft.image);
      }
      const response = await fetch(
        `/api/background-presets/${encodeURIComponent(backgroundPresetEditDraft.id)}`,
        { method: "PUT", body: form },
      );
      const result = (await response.json()) as {
        preset?: BackgroundPreset;
        error?: string;
      };
      if (!response.ok || !result.preset) {
        throw new Error(result.error ?? "候选背景保存失败");
      }

      const updated = result.preset;
      setBackgroundPresets((current) =>
        current.map((preset) => (preset.id === updated.id ? updated : preset)),
      );
      setBackgroundPresetAvailability((current) => ({
        ...current,
        [updated.id]: true,
      }));
      const wasSelected = selectedBackgroundPresetId === updated.id;
      closeBackgroundPresetEditor();
      if (wasSelected) {
        if (!updated.assetPath || !updated.assetFileName) {
          throw new Error("更新后的背景图片不存在");
        }
        const imageResponse = await fetch(updated.assetPath, { cache: "no-store" });
        if (!imageResponse.ok) throw new Error("更新后的背景图片读取失败");
        const blob = await imageResponse.blob();
        acceptReferenceFile(
          new File([blob], updated.assetFileName, {
            type: blob.type || "image/jpeg",
          }),
          updated.id,
        );
        applyBackgroundPresetPrompt(updated);
      }
      setToast(`「${updated.title}」已更新`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "候选背景保存失败");
      setIsSavingBackgroundPreset(false);
    }
  }

  async function deleteBackgroundPresetRecord(preset: BackgroundPreset) {
    if (status === "processing") return;
    if (!window.confirm(`确定删除候选背景「${preset.title}」吗？`)) return;
    setError("");
    try {
      const response = await fetch(
        `/api/background-presets/${encodeURIComponent(preset.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error(await readResponseError(response, "候选背景删除失败"));
      }
      setBackgroundPresets((current) =>
        current.filter((candidate) => candidate.id !== preset.id),
      );
      setBackgroundPresetAvailability((current) => {
        const next = { ...current };
        delete next[preset.id];
        return next;
      });
      if (selectedBackgroundPresetId === preset.id) {
        if (referenceUrl) URL.revokeObjectURL(referenceUrl);
        setReferenceFile(null);
        setReferenceUrl("");
        setSelectedBackgroundPresetId(null);
        setBackgroundPromptIsComposed(false);
        setPrompt("");
        setProcessResults([]);
        setStatus(file ? "ready" : "empty");
      }
      setToast(`已删除「${preset.title}」`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "候选背景删除失败");
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    acceptFiles(Array.from(event.dataTransfer.files ?? []));
  }

  function insertMention(text: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart ?? prompt.length;
    const beforeCursor = prompt.slice(0, cursor);
    const tokenStart = beforeCursor.lastIndexOf("@");
    const activeToken = tokenStart >= 0 && !/\s/.test(beforeCursor.slice(tokenStart));
    const prefix = activeToken
      ? beforeCursor.slice(0, tokenStart)
      : `${beforeCursor}${beforeCursor && !/\s$/.test(beforeCursor) ? " " : ""}`;
    const nextPrompt = `${prefix}@${text} ${prompt.slice(cursor)}`.slice(
      0,
      promptMaxLength,
    );
    const nextCursor = Math.min(prefix.length + text.length + 2, nextPrompt.length);
    setPrompt(nextPrompt);
    setSkillMenuOpen(false);
    setSkillQuery("");
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function insertSkillMention(skillName: string) {
    if (disabledSkillSet.has(skillName)) {
      setToast(`@${skillName} 已停用，启用后才能调用`);
      return;
    }
    insertMention(skillName);
  }

  function insertImageRef(id: string) {
    insertMention(id);
  }

  function applyPromptPreset(preset: PromptPreset) {
    const nextPrompt = getFlatPaperCutPresetPrompt(
      preset,
      Boolean(referenceFile),
    ).slice(0, promptMaxLength);
    setPrompt(nextPrompt);
    setSkillMenuOpen(false);
    setSkillQuery("");
    setError("");
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function clearPromptForCustomInput() {
    setPrompt("");
    setSkillMenuOpen(false);
    setSkillQuery("");
    setError("");
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function toggleSkillEnabled(skillName: string) {
    setDisabledSkillNames((current) => {
      const disabled = current.includes(skillName);
      const next = disabled
        ? current.filter((name) => name !== skillName)
        : [...current, skillName];
      setToast(disabled ? `@${skillName} 已启用` : `@${skillName} 已停用`);
      return next;
    });
  }

  function handlePromptChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextPrompt = event.target.value;
    const cursor = event.target.selectionStart;
    const mention = nextPrompt.slice(0, cursor).match(/@([\u4e00-\u9fa5a-z0-9-]*)$/i);
    setPrompt(nextPrompt);
    setSkillQuery(mention?.[1] ?? "");
    setSkillMenuOpen(Boolean(mention));
  }

  async function importSkill(event: ChangeEvent<HTMLInputElement>) {
    const skillFile = event.target.files?.[0];
    event.target.value = "";
    if (!skillFile) return;

    setError("");
    setIsImportingSkill(true);
    try {
      const form = new FormData();
      form.set("skill", skillFile);
      const response = await fetch("/api/skills", {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as {
        skill?: SkillMetadata;
        error?: string;
      };
      if (!response.ok || !result.skill) {
        throw new Error(result.error ?? "Skill 导入失败");
      }

      setSkills(await fetchAvailableSkills());
      insertMention(result.skill.name);
      setToast(`Skill @${result.skill.name} 已导入`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Skill 导入失败");
    } finally {
      setIsImportingSkill(false);
    }
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && skillMenuOpen) {
      event.preventDefault();
      setSkillMenuOpen(false);
      return;
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      skillMenuOpen &&
      firstEnabledFilteredSkill
    ) {
      event.preventDefault();
      insertSkillMention(firstEnabledFilteredSkill.name);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void processImage();
    }
  }

  function canGenerate() {
    if (sourceImages.length === 0) return false;
    if (isBackgroundReplaceMode && !referenceFile) return false;
    return true;
  }

  async function readResponseError(response: Response, fallback: string) {
    try {
      const result = (await response.json()) as { error?: string };
      return result.error ?? fallback;
    } catch {
      return fallback;
    }
  }

  function resetWorkspaceAfterTaskSubmission() {
    sourceImages.forEach((source) => URL.revokeObjectURL(source.previewUrl));
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    setSourceImages([]);
    setReferenceFile(null);
    setReferenceUrl("");
    setSelectedBackgroundPresetId(null);
    setBackgroundPromptIsComposed(false);
    setSelectedWardrobePresetId(null);
    setPrompt("");
    setIsReferenceOnTop(false);
    setProcessResults([]);
    setStatus("empty");
  }

  async function submitGenerationTask(cleanPrompt: string) {
    const form = new FormData();
    sourceImages.forEach((source) => form.append("images", source.file));
    if (referenceFile) form.set("referenceImage", referenceFile);
    form.set("prompt", cleanPrompt);
    form.set("modelId", selectedModelId);
    if (usesGeneralBackgroundPrompt) {
      form.set("backgroundPresetId", GENERAL_BACKGROUND_PRESET_ID);
    }
    if (
      isBackgroundReplace &&
      !usesGeneralBackgroundPrompt &&
      backgroundPromptIsComposed
    ) {
      form.set("backgroundPromptMode", "composed");
    }
    if (
      WARDROBE_FEATURE_ENABLED &&
      isBackgroundReplace &&
      !usesGeneralBackgroundPrompt &&
      selectedWardrobePresetId
    ) {
      form.set("wardrobePresetId", selectedWardrobePresetId);
    }
    if (supportsGuidance) {
      form.set("strength", String(strength));
      form.set("disabledSkillNames", JSON.stringify(activeDisabledSkillNames));
    }

    const response = await fetch("/api/generation-tasks", {
      method: "POST",
      headers: createArkRequestHeaders(arkSettings),
      body: form,
    });
    const result = (await response.json()) as {
      task?: GenerationTask;
      error?: string;
    };
    if (!response.ok || !result.task) {
      throw new Error(result.error ?? "后台任务提交失败");
    }

    taskStatusesRef.current.set(result.task.id, result.task.status);
    setGenerationTasks((current) => [
      result.task!,
      ...current.filter((task) => task.id !== result.task!.id),
    ]);
    resetWorkspaceAfterTaskSubmission();
    setToast(
      `${result.task.total} 张图片已进入后台，可以继续创建下一个任务`,
    );
  }

  async function processImage() {
    if (isSubmittingTask) return;
    if (!file) {
      inputRef.current?.click();
      return;
    }
    if (isBackgroundReplaceMode && !referenceFile) {
      setError("背景替换模式需要上传背景参考图");
      return;
    }
    const cleanPrompt = usesGeneralBackgroundPrompt
      ? GENERAL_BACKGROUND_REPLACE_PROMPT
      : prompt.trim();
    if (!cleanPrompt) {
      setError("请先描述想要的照片效果");
      return;
    }

    setError("");
    setIsSubmittingTask(true);
    try {
      await submitGenerationTask(cleanPrompt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "后台任务提交失败");
    } finally {
      setIsSubmittingTask(false);
    }
  }

  async function createResultBlob(imageUrl: string) {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("无法读取处理结果");
    return response.blob();
  }

  async function downloadResult(target?: ProcessResultItem) {
    try {
      const targets = target ? [target] : successfulResults;
      if (targets.length === 0) throw new Error("请先生成照片");

      for (const result of targets) {
        if (!result.imageUrl) continue;
        const blob = await createResultBlob(result.imageUrl);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const baseName = result.fileName.replace(/\.[^.]+$/, "") || "photo";
        const extension =
          blob.type === "image/png"
            ? "png"
            : blob.type === "image/webp"
              ? "webp"
              : "jpg";
        link.href = url;
        link.download = `${baseName}-playground.${extension}`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setToast(`${targets.length} 张处理结果已下载`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "下载失败");
    }
  }

  async function shareResult() {
    try {
      if (successfulResults.length === 0) throw new Error("请先生成照片");
      const resultFiles = await Promise.all(
        successfulResults.map(async (result) => {
          const blob = await createResultBlob(result.imageUrl!);
          const extension =
            blob.type === "image/png"
              ? "png"
              : blob.type === "image/webp"
                ? "webp"
                : "jpg";
          const baseName = result.fileName.replace(/\.[^.]+$/, "") || "photo";
          return new File([blob], `${baseName}-playground.${extension}`, {
            type: blob.type,
          });
        }),
      );
      if (navigator.share && navigator.canShare?.({ files: resultFiles })) {
        await navigator.share({
          title: "PlayGround 照片作品",
          text: "这是我使用 PlayGround 创作的照片",
          files: resultFiles,
        });
      } else {
        await downloadResult();
        setToast("当前浏览器不支持批量文件分享，已为你下载");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "分享失败");
    }
  }

  function resetAdjustments() {
    setStrength(72);
    setProcessResults([]);
    setStatus(file ? "ready" : "empty");
  }

  const {
    mainImageLabel,
    referenceImageLabel,
    headerTitle,
    eyebrow,
    headingTitle,
    headingSubtitle,
    placeholderText,
    generateButtonText,
    missingUploadText,
  } = modeCopy;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="PlayGround 首页">
          <span className="brand-mark"><WandSparkles size={19} /></span>
          <span>PlayGround</span>
        </a>
        <div className="topbar-status">
          <span className="status-dot" />
          {headerTitle}
        </div>
        <div className="topbar-actions">
          <button
            className={`task-trigger ${activeGenerationTasks.length > 0 ? "active" : ""}`}
            type="button"
            onClick={() => setTaskPanelOpen((open) => !open)}
            aria-label="查看后台生成任务"
            aria-expanded={taskPanelOpen}
          >
            <Sparkles size={16} />
            <span>后台任务</span>
            {activeGenerationTasks.length > 0 && (
              <b>{activeGenerationTasks.length}</b>
            )}
          </button>
          <button
            className="history-trigger"
            type="button"
            onClick={openHistory}
            aria-label="打开生成历史"
          >
            <HistoryIcon size={16} />
            <span>历史</span>
            {historyItems.length > 0 && <b>{historyItems.length}</b>}
          </button>
          <button
            className={`settings-trigger ${hasConfiguredProvider ? "configured" : ""}`}
            type="button"
            onClick={openSettings}
            aria-label="打开 API 设置"
          >
            <Settings size={16} />
            <span>设置</span>
            <i aria-hidden="true" />
          </button>
        </div>
      </header>

      {taskPanelOpen && (
        <section className="task-popover" role="dialog" aria-label="后台生成任务">
          <div className="task-popover-header">
            <div>
              <strong>后台生成任务</strong>
              <small>
                {activeGenerationTasks.length > 0
                  ? `${activeGenerationTasks.length} 个任务正在进行，可继续创建新任务`
                  : "当前没有进行中的任务"}
              </small>
            </div>
            <button
              type="button"
              onClick={() => setTaskPanelOpen(false)}
              aria-label="关闭后台任务"
            >
              <X size={15} />
            </button>
          </div>
          {generationTasks.length === 0 ? (
            <div className="task-popover-empty">
              <Sparkles size={18} />
              <span>提交生成后，任务进度会显示在这里</span>
            </div>
          ) : (
            <div className="task-list">
              {generationTasks.slice(0, 8).map((task) => {
                const model = MODELS.find((item) => item.id === task.modelId);
                const isActive = isActiveGenerationTask(task);
                return (
                  <article className={`task-item ${task.status}`} key={task.id}>
                    <div className="task-item-heading">
                      <span>
                        <strong>{model?.name ?? task.modelId}</strong>
                        <small>
                          {formatTaskTime(task.createdAt)} · {task.total} 张
                        </small>
                      </span>
                      <b>{getTaskStatusLabel(task.status)}</b>
                    </div>
                    <div className={`task-progress ${isActive ? "active" : ""}`}>
                      <i style={{ width: `${task.progress}%` }} />
                    </div>
                    <div className="task-item-meta">
                      <span>{task.stage}</span>
                      <span>{task.completed}/{task.total}</span>
                    </div>
                    {task.error && <p>{task.error}</p>}
                    {task.succeeded > 0 && !isActive && (
                      <button
                        className="task-history-link"
                        type="button"
                        onClick={() => {
                          if (task.latestHistoryItemId) {
                            setSelectedHistoryId(task.latestHistoryItemId);
                          }
                          openHistory();
                        }}
                      >
                        <HistoryIcon size={13} /> 在历史任务中查看
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      <div className="workspace">
        <section className="stage-panel" aria-label="照片预览区">
          <div className="stage-heading">
            <div>
              <p className="eyebrow">{eyebrow}</p>
              <h1>{headingTitle}</h1>
              <p className="subtitle">
                {headingSubtitle}
                {isBackgroundReplaceMode && imageProviderStatus
                  ? ` 当前服务：${
                      usesYouPai
                        ? `YouPai · ${imageProviderStatus.backgroundReplaceModel}${
                            imageProviderStatus.youpaiConfigured ? "" : "（未配置 API Key）"
                          }`
                        : usesApiModels
                          ? `APIMODELS · ${imageProviderStatus.backgroundReplaceModel}${
                              imageProviderStatus.apiModelsConfigured
                                ? ""
                                : "（未配置 API Key）"
                            }`
                        : usesLovart
                        ? `Lovart · GPT Image 2.5${
                            imageProviderStatus.lovartConfigured ? "" : "（未配置 AK/SK）"
                          }`
                        : "火山方舟 · Seedream"
                    }。`
                  : ""}
              </p>
            </div>
            <div className="stage-heading-actions">
              {file && (
                <button
                  className="quiet-button"
                  onClick={() => inputRef.current?.click()}
                  disabled={
                    status === "processing" ||
                    (isBatchMode && sourceImages.length >= MAX_BATCH_IMAGES)
                  }
                >
                  <ImagePlus size={17} />
                  {isBatchMode ? "继续添加主图" : `更换${mainImageLabel}`}
                </button>
              )}
              {isBatchMode && sourceImages.length > 1 && (
                <button
                  className="quiet-button"
                  onClick={clearSourceImages}
                  disabled={status === "processing"}
                >
                  <X size={17} /> 清空主图
                </button>
              )}
              {referenceFile && (
                <button
                  className="quiet-button"
                  onClick={() => referenceInputRef.current?.click()}
                  disabled={status === "processing"}
                >
                  <ImagePlus size={17} /> 更换{referenceImageLabel}
                </button>
              )}
            </div>
          </div>

          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            multiple={isBatchMode}
            onChange={handleInput}
          />
          <input
            ref={referenceInputRef}
            className="sr-only"
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            onChange={handleReferenceInput}
          />

          {!file && !referenceFile ? (
            <div
              className={`upload-zone ${isDragging ? "is-dragging" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
              }}
            >
              <span className="upload-icon"><ImagePlus size={29} /></span>
              <h2>{isBatchMode ? "拖入最多 10 张照片" : "拖入一张照片"}</h2>
              <p>{isBatchMode ? "或点击批量选择本地文件" : "或点击选择本地文件"}</p>
              <span className="upload-meta">
                JPG、PNG、WebP · 每张最大 15 MB
              </span>
            </div>
          ) : (
            <div className="preview-card">
              {/* Toolbar */}
              <div className="preview-toolbar">
                <span className="toolbar-label">
                  {isBatchMode
                    ? `批量主图 ${sourceImages.length}/${MAX_BATCH_IMAGES}`
                    : status === "complete"
                      ? "生成结果"
                      : "图片预览"}
                </span>
                <span className="file-info">
                  {isBatchMode
                    ? `${formatSize(sourceImages.reduce((sum, source) => sum + source.file.size, 0))} · 共用同一提示词`
                    : file
                      ? `${file.name} · ${formatSize(file.size)}`
                      : "等待上传主图"}
                </span>
              </div>

              {/* Image area */}
              {isBatchMode ? (
                <div className="batch-preview-area">
                  {referenceFile && (
                    <div className="batch-reference-bar">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={referenceUrl} alt="批量任务共享参考图" />
                      <span>
                        <strong>共享{referenceImageLabel}</strong>
                        <small>{referenceFile.name} · 所有主图共用</small>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (referenceUrl) URL.revokeObjectURL(referenceUrl);
                          setReferenceFile(null);
                          setReferenceUrl("");
                          setSelectedBackgroundPresetId(null);
                          setProcessResults([]);
                          setStatus(sourceImages.length > 0 ? "ready" : "empty");
                        }}
                        disabled={status === "processing"}
                        aria-label="移除共享参考图"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <div className="batch-image-grid">
                    {sourceImages.map((source, index) => {
                      const result = processResults.find(
                        (item) => item.sourceId === source.id,
                      );
                      const isComplete =
                        result?.status === "complete" && result.imageUrl;
                      return (
                        <article
                          className={`batch-image-card ${result?.status ?? "ready"}`}
                          key={source.id}
                        >
                          <div className="batch-image-canvas">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={isComplete ? result.imageUrl : source.previewUrl}
                              alt={isComplete ? `${source.file.name} 的生成结果` : source.file.name}
                            />
                            <span className="batch-image-index">
                              {isComplete ? "生成结果" : `图 ${index + 1}`}
                            </span>
                            {isComplete && (
                              <span className="batch-source-thumb" title="原始主图">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={source.previewUrl} alt="原始主图缩略图" />
                              </span>
                            )}
                            {result?.status === "processing" && (
                              <span className="batch-item-state processing">
                                <Sparkles size={13} /> 处理中
                              </span>
                            )}
                            {result?.status === "error" && (
                              <span className="batch-item-error">{result.error}</span>
                            )}
                            {result?.status === "complete" ? (
                              <button
                                className="batch-item-download"
                                type="button"
                                onClick={() => void downloadResult(result)}
                                aria-label={`下载 ${source.file.name} 的生成结果`}
                              >
                                <ArrowDownToLine size={14} />
                              </button>
                            ) : (
                              status !== "processing" && (
                                <button
                                  className="image-remove-btn"
                                  type="button"
                                  onClick={() => removeSourceImage(source.id)}
                                  aria-label={`移除 ${source.file.name}`}
                                >
                                  <X size={14} />
                                </button>
                              )
                            )}
                          </div>
                          <footer>
                            <strong>{source.file.name}</strong>
                            <small>
                              {result?.status === "complete"
                                ? "已完成"
                                : result?.status === "error"
                                  ? "生成失败"
                                  : formatSize(source.file.size)}
                            </small>
                          </footer>
                        </article>
                      );
                    })}
                    {sourceImages.length < MAX_BATCH_IMAGES && status !== "processing" && (
                      <button
                        className="batch-add-card"
                        type="button"
                        onClick={() => inputRef.current?.click()}
                      >
                        <ImagePlus size={24} />
                        <strong>继续添加</strong>
                        <small>还可上传 {MAX_BATCH_IMAGES - sourceImages.length} 张</small>
                      </button>
                    )}
                  </div>
                </div>
              ) : status === "complete" ? (
                <div className="images-grid-result">
                  {/* Result image: left, larger */}
                  <div className="image-stage result-main">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={resultUrl} alt="AI 生成结果" className="preview-image" />
                  </div>
                  {/* Original + reference stack: exposed bottom card swaps to the front. */}
                  <div className="image-stack">
                    {referenceFile ? (
                      <>
                        <button
                          className="image-stage image-stack-card image-stack-bottom"
                          type="button"
                          onClick={() => setIsReferenceOnTop((current) => !current)}
                          aria-label={`查看${isReferenceOnTop ? mainImageLabel : referenceImageLabel}`}
                        >
                          <span className="image-tag">
                            {isReferenceOnTop ? mainImageLabel : referenceImageLabel}
                          </span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={isReferenceOnTop ? sourceUrl : referenceUrl}
                            alt={isReferenceOnTop ? "原始照片" : "参考图"}
                            className="preview-image"
                          />
                        </button>
                        <div className="image-stage image-stack-card image-stack-top">
                          <span className="image-tag">
                            {isReferenceOnTop ? referenceImageLabel : mainImageLabel}
                          </span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={isReferenceOnTop ? referenceUrl : sourceUrl}
                            alt={isReferenceOnTop ? "参考图" : "原始照片"}
                            className="preview-image"
                          />
                        </div>
                      </>
                    ) : (
                      <div
                        className="image-stage image-stack-placeholder"
                        onClick={() => referenceInputRef.current?.click()}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") referenceInputRef.current?.click();
                        }}
                      >
                        <ImagePlus size={20} />
                        <span>添加参考图</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="images-grid-input">
                  {/* Main image: left */}
                  <div className="image-stage">
                    {file ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={sourceUrl} alt="原始照片" className="preview-image" />
                    ) : (
                      <div className="upload-placeholder" onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}>
                        <ImagePlus size={24} />
                        <span>上传{mainImageLabel}</span>
                        <small>点击选择</small>
                      </div>
                    )}
                  </div>
                  {/* Reference image: right */}
                  <div className="image-stage">
                    {referenceFile ? (
                      <>
                        <span className="image-tag">
                          {selectedBackgroundPreset && !usesGeneralBackgroundPrompt
                            ? selectedBackgroundPreset.title
                            : referenceImageLabel}
                        </span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={referenceUrl} alt="参考图" className="preview-image" />
                        <button
                          className="image-remove-btn"
                          onClick={() => {
                            if (referenceUrl) URL.revokeObjectURL(referenceUrl);
                            setReferenceFile(null);
                            setReferenceUrl("");
                            setSelectedBackgroundPresetId((current) =>
                              isGeneralBackgroundPreset(current) ? current : null,
                            );
                            setProcessResults([]);
                            setStatus(file ? "ready" : "empty");
                          }}
                          aria-label="移除参考图"
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <div className="upload-placeholder" onClick={() => referenceInputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") referenceInputRef.current?.click(); }}>
                        <ImagePlus size={24} />
                        <span>上传{referenceImageLabel}</span>
                        <small>{isBackgroundReplaceMode ? "必填" : "可选"}</small>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action bar */}
              <div className="result-actions">
                <div className="result-state">
                  {successfulResults.length > 0 ? (
                    <><span className="complete-icon"><Check size={14} /></span> 已生成 {successfulResults.length} 张高清结果</>
                  ) : (
                    <><span className="live-icon" /> 等待生成</>
                  )}
                </div>
                <div className="action-group">
                  <button className="icon-action" onClick={() => void shareResult()} aria-label="分享结果" disabled={successfulResults.length === 0}>
                    <Share2 size={17} /><span>{isBatchMode ? "分享全部" : "分享"}</span>
                  </button>
                  <button className="icon-action primary" onClick={() => void downloadResult()} disabled={successfulResults.length === 0}>
                    <ArrowDownToLine size={17} /><span>{isBatchMode ? "下载全部" : "下载"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && <div className="error-message" role="alert">{error}</div>}
        </section>

        <aside className="control-panel" aria-label="创作设置">
          {/* Mode selector */}
          <div className="panel-section mode-section">
            <div className="section-title">
              <span className="step-number">01</span>
              <div><h2>选择处理模式</h2><p>按模式选择图片服务，并应用对应处理策略</p></div>
            </div>
            <div className="model-list">
              {MODELS.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={`model-option ${selectedModelId === model.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedModelId(model.id);
                    if (model.id === "background-replace" && selectedBackgroundPreset) {
                      const isGeneralPreset = isGeneralBackgroundPreset(
                        selectedBackgroundPreset,
                      );
                      setPrompt(
                        isGeneralPreset
                          ? GENERAL_BACKGROUND_REPLACE_PROMPT
                          : buildBackgroundReplacePrompt(
                              getBackgroundPresetPrompt(selectedBackgroundPreset),
                            ).slice(0, getPromptMaxLength("background-replace")),
                      );
                      setBackgroundPromptIsComposed(!isGeneralPreset);
                      setSkillMenuOpen(false);
                      setSkillQuery("");
                    } else if (
                      model.id !== "background-replace" &&
                      (prompt === GENERAL_BACKGROUND_REPLACE_PROMPT ||
                        backgroundPromptIsComposed)
                    ) {
                      setPrompt("");
                      setBackgroundPromptIsComposed(false);
                    }
                    setProcessResults([]);
                    setStatus(file ? "ready" : "empty");
                    if (isBackgroundReplaceModel(model.id) && sourceImages.length > 1) {
                      setToast("背景替换一次只处理第一张主体图，切回创作模式可恢复批量");
                    }
                  }}
                >
                  <span className="model-glyph" style={{ "--model-color": model.accent } as React.CSSProperties}>
                    <WandSparkles size={18} />
                  </span>
                  <span className="model-copy">
                    <strong>{model.name}</strong>
                    <small>{model.description}</small>
                  </span>
                  <span className="radio-mark"><Check size={12} /></span>
                </button>
              ))}
            </div>
          </div>

          {isBackgroundReplace && (
            <div className="panel-section background-presets-section">
              <div className="section-title">
                <span className="step-number">02</span>
                <div>
                  <h2>选择候选背景</h2>
                  <p>通用模式或 {backgroundPresets.length - 1} 个地点；通用模式不预设背景图</p>
                </div>
              </div>
              <div className="background-preset-list">
                {orderedBackgroundPresets.map((preset) => {
                  const isSelected = selectedBackgroundPresetId === preset.id;
                  const isLoading = loadingBackgroundPresetId === preset.id;
                  const isAvailable = backgroundPresetAvailability[preset.id] === true;
                  const isMissing = backgroundPresetAvailability[preset.id] === false;
                  const isGeneralPreset = isGeneralBackgroundPreset(preset);
                  const placementProfile = isGeneralPreset
                    ? null
                    : getBackgroundPlacementProfile(preset);

                  return (
                    <div className="background-preset-card-shell" key={preset.id}>
                      <button
                        className={`background-preset-card ${isGeneralPreset ? "general-preset" : ""}`}
                        type="button"
                        aria-pressed={isSelected}
                        disabled={status === "processing" || Boolean(loadingBackgroundPresetId)}
                        title={isGeneralPreset
                          ? "不预设背景图片；仅启用固定通用提示词"
                          : `${placementProfile!.grade}级 · ${placementProfile!.gradeLabel}\n${placementProfile!.recommendedCropLabel}\n${placementProfile!.note}\n\n${preset.prompt}`}
                        onClick={() => void applyBackgroundPreset(preset)}
                      >
                      <span
                        className="background-preset-visual"
                        style={{
                          "--preset-accent": preset.accent,
                          "--preset-tint": preset.tint,
                        } as React.CSSProperties}
                      >
                        {!isGeneralPreset && !isMissing && preset.thumbnailPath && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={preset.thumbnailPath}
                            alt=""
                            onLoad={() => setBackgroundPresetAvailability((current) => ({
                              ...current,
                              [preset.id]: true,
                            }))}
                            onError={() => setBackgroundPresetAvailability((current) => ({
                              ...current,
                              [preset.id]: false,
                            }))}
                          />
                        )}
                        <span aria-hidden="true">{preset.monogram}</span>
                      </span>
                      <span className="background-preset-copy">
                        <span className="background-preset-heading">
                          <strong>{preset.title}</strong>
                          <small>{preset.location}</small>
                        </span>
                        {isGeneralPreset ? (
                          <span className="background-preset-profile general-profile">
                            <strong>无预设背景</strong>
                            <span>固定通用提示词</span>
                          </span>
                        ) : (
                          <span className="background-preset-profile">
                            <strong data-grade={placementProfile!.grade}>
                              {placementProfile!.grade}级 · {placementProfile!.gradeLabel}
                            </strong>
                            <span>{placementProfile!.recommendedCropLabel}</span>
                          </span>
                        )}
                        <small>{preset.summary}</small>
                        <span className="background-preset-status">
                          {isGeneralPreset
                            ? isSelected
                              ? referenceFile
                                ? "通用提示词已启用 · 已上传背景"
                                : "通用提示词已启用 · 请上传背景"
                              : "仅填入通用提示词"
                            : isLoading
                            ? "正在设置背景…"
                            : isSelected
                              ? "背景与完整提示词已设置"
                              : isAvailable
                                ? "一键选用"
                                : isMissing
                                  ? "背景素材待上传"
                                  : "正在检查素材…"}
                        </span>
                      </span>
                        <span className="background-preset-check" aria-hidden="true">
                          {isSelected
                            ? <Check size={12} />
                            : !isGeneralPreset && isMissing
                              ? "待图"
                              : "选择"}
                        </span>
                      </button>
                      {!isGeneralPreset && <span className="background-preset-tools">
                        <button
                          type="button"
                          onClick={() => openBackgroundPresetEditor(preset)}
                          disabled={status === "processing"}
                          aria-label={`编辑${preset.title}`}
                          title="编辑候选背景"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          className="danger"
                          type="button"
                          onClick={() => void deleteBackgroundPresetRecord(preset)}
                          disabled={status === "processing"}
                          aria-label={`删除${preset.title}`}
                          title="删除候选背景"
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {WARDROBE_FEATURE_ENABLED && isBackgroundReplace && !usesGeneralBackgroundPrompt && (
            <div className="panel-section wardrobe-section">
              <div className="section-title">
                <span className="step-number">03</span>
                <div>
                  <h2>选择服装积木</h2>
                  <p>可选 · 背景只负责场景，服装仅在明确选中后替换</p>
                </div>
              </div>
              <div className="wardrobe-options">
                <button
                  className="wardrobe-option wardrobe-option-original"
                  type="button"
                  aria-pressed={!selectedWardrobePresetId}
                  onClick={() => selectWardrobePreset(null)}
                >
                  <span className="wardrobe-monogram"><Shirt size={17} /></span>
                  <span className="wardrobe-option-copy">
                    <strong>保持原服装</strong>
                    <small>不注入任何换装指令</small>
                  </span>
                  <span className="wardrobe-option-state">
                    {!selectedWardrobePresetId ? <Check size={11} /> : "选择"}
                  </span>
                </button>
                {wardrobeOptions.map((preset) => {
                  const isSelected = selectedWardrobePresetId === preset.id;
                  const isRecommended = preset.recommendedBackgroundIds.includes(
                    selectedBackgroundPresetId ?? "",
                  );
                  return (
                    <button
                      key={preset.id}
                      className="wardrobe-option"
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => selectWardrobePreset(preset.id)}
                      style={{
                        "--wardrobe-accent": preset.accent,
                        "--wardrobe-tint": preset.tint,
                      } as React.CSSProperties}
                    >
                      <span className="wardrobe-monogram" aria-hidden="true">
                        {preset.monogram}
                      </span>
                      <span className="wardrobe-option-copy">
                        <span>
                          <strong>{preset.title}</strong>
                          {isRecommended && <em>推荐</em>}
                        </span>
                        <small>{preset.era} · {preset.summary}</small>
                      </span>
                      <span className="wardrobe-option-state" aria-hidden="true">
                        {isSelected ? <Check size={11} /> : "选择"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {selectedWardrobePreset && (
                <details className="wardrobe-prompt-preview">
                  <summary>查看已启用的服装提示词</summary>
                  <p>{getWardrobePrompt(selectedWardrobePreset)}</p>
                </details>
              )}
            </div>
          )}

          <div className="panel-section prompt-section">
            <div className="section-title">
              <span className="step-number">
                {isBackgroundReplace
                  ? WARDROBE_FEATURE_ENABLED && !usesGeneralBackgroundPrompt
                    ? "04"
                    : "03"
                  : "02"}
              </span>
              <div>
                <h2>
                  {usesGeneralBackgroundPrompt
                    ? "通用背景替换提示词"
                    : isBackgroundReplace && backgroundPromptIsComposed
                      ? "完整背景替换提示词"
                      : "描述你的想法"}
                </h2>
                <p>
                  {usesGeneralBackgroundPrompt
                    ? "固定提示词原样发送；不追加系统提示词、Skill、强度或结束语"
                    : isBackgroundReplace && backgroundPromptIsComposed
                      ? "系统规则与候选要求已完整拼接；编辑后的可见内容将原样发送"
                    : isBackgroundReplace
                      ? "系统硬约束优先于你的场景要求；输入 @ 引用图片"
                      : isUserPromptOnly
                        ? "提示词原样发送；输入 @ 仅引用已上传图片"
                        : "输入 @ 可引用图片或调用 Skill"}
                </p>
              </div>
            </div>
            <div className="prompt-box">
              <textarea
                ref={textareaRef}
                value={prompt}
                maxLength={promptMaxLength}
                onChange={handlePromptChange}
                onKeyDown={handlePromptKeyDown}
                placeholder={placeholderText}
                readOnly={usesGeneralBackgroundPrompt}
                aria-readonly={usesGeneralBackgroundPrompt}
              />
              {skillMenuOpen && !usesGeneralBackgroundPrompt && (
                <div className="skill-mention-menu" role="listbox" aria-label="引用菜单">
                  <div className="skill-menu-heading">
                    <span>选择引用</span>
                    <small>{mentionItemCount} 个可用</small>
                  </div>
                  <div className="skill-menu-options">
                    {hasMenuItems ? (
                      <>
                        {/* Image references */}
                        {filteredImageRefs.map((ref) => (
                          <div key={ref.id} className="skill-menu-option" role="option" aria-selected="false">
                            <button
                              className="skill-insert-button"
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => insertImageRef(ref.id)}
                              title={ref.desc}
                            >
                              <ImagePlus size={14} />
                              <span>
                                <strong>{ref.label}</strong>
                                <small>{ref.desc}</small>
                              </span>
                            </button>
                          </div>
                        ))}
                        {/* Skills */}
                        {filteredSkills.map((skill) => {
                          const disabled = disabledSkillSet.has(skill.name);
                          return (
                            <div
                              key={skill.name}
                              className={`skill-menu-option ${disabled ? "disabled" : ""}`}
                              role="option"
                              aria-selected="false"
                              aria-disabled={disabled}
                            >
                              <button
                                className="skill-insert-button"
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => insertSkillMention(skill.name)}
                                disabled={disabled}
                                title={disabled ? "该 Skill 已停用" : `调用 @${skill.name}`}
                              >
                                <AtSign size={14} />
                                <span>
                                  <strong>{skill.name}</strong>
                                </span>
                              </button>
                              <button
                                className="skill-toggle-button"
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => toggleSkillEnabled(skill.name)}
                                aria-pressed={!disabled}
                              >
                                {disabled ? "启用" : "Disable"}
                              </button>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <p>{mentionItemCount === 0 ? (!supportsGuidance ? "尚未上传可引用的图片" : "尚未导入 Skill 或上传图片") : "没有匹配的选项"}</p>
                    )}
                  </div>
                  {supportsGuidance && (
                    <button
                      className="import-skill-button"
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => skillFileRef.current?.click()}
                      disabled={isImportingSkill}
                    >
                      <FileUp size={14} />
                      {isImportingSkill ? "导入中..." : "导入 SKILL.md"}
                    </button>
                  )}
                </div>
              )}
              <div className="prompt-footer">
                <div className="prompt-meta">
                  {!usesGeneralBackgroundPrompt && (
                    <button
                      type="button"
                      className={skillMenuOpen ? "active" : ""}
                      onClick={() => {
                        setSkillQuery("");
                        setSkillMenuOpen((open) => !open);
                        textareaRef.current?.focus();
                      }}
                      aria-label={!supportsGuidance ? "引用图片" : "调用 Skill 或引用图片"}
                    >
                      <AtSign size={14} />引用
                    </button>
                  )}
                  {usesGeneralBackgroundPrompt && <small>固定 · 原样发送</small>}
                  {isBackgroundReplace &&
                    backgroundPromptIsComposed &&
                    !usesGeneralBackgroundPrompt && (
                      <small>完整可见 · 原样发送</small>
                    )}
                  {supportsGuidance && activeDisabledSkillNames.length > 0 && (
                    <small className="disabled-skill-count">
                      已停用 {activeDisabledSkillNames.length}
                    </small>
                  )}
                  <span>{prompt.length}/{promptMaxLength}</span>
                </div>
                <button className="reference-upload-button" onClick={() => referenceInputRef.current?.click()} type="button">
                  <ImagePlus size={14} />
                  {referenceFile ? `更换${referenceImageLabel}` : `上传${referenceImageLabel}`}
                </button>
              </div>
              <input
                ref={skillFileRef}
                className="sr-only"
                type="file"
                accept=".md,text/markdown,text/plain"
                onChange={(event) => void importSkill(event)}
              />
            </div>
            {isFlatPaperCut && (
              <div className="prompt-recommendations" aria-label="推荐提示词">
                <div className="prompt-recommendations-header">
                  <div className="prompt-recommendations-title">
                    <span aria-hidden="true"><Sparkles size={13} /></span>
                    <div>
                      <strong>三个灵感起点</strong>
                      <small>可选 · 点击填入后仍可自由改写</small>
                    </div>
                  </div>
                  <button
                    className="clear-prompt-button"
                    type="button"
                    onClick={clearPromptForCustomInput}
                    disabled={!prompt}
                  >
                    <X size={11} />
                    清空，自由输入
                  </button>
                </div>
                <div className="prompt-recommendation-list">
                  {FLAT_PAPER_CUT_PROMPT_PRESETS.map((preset, index) => {
                    const presetPrompt = getFlatPaperCutPresetPrompt(
                      preset,
                      Boolean(referenceFile),
                    );
                    const isSelected = prompt === presetPrompt;
                    return (
                      <button
                        key={preset.id}
                        className="prompt-recommendation"
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => applyPromptPreset(preset)}
                      >
                        <span className="prompt-recommendation-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="prompt-recommendation-copy">
                          <strong>{preset.title}</strong>
                          <small>{preset.summary}</small>
                        </span>
                        <span className="prompt-recommendation-state" aria-hidden="true">
                          {isSelected ? <Check size={11} /> : "选用"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {supportsGuidance && (
            <div className="panel-section strength-section">
              <div className="strength-heading">
                <span><strong>创作强度</strong><small>控制最终效果与原图的接近程度</small></span>
                <b>{strength}%</b>
              </div>
              <input
                className="strength-range"
                type="range"
                min="0"
                max="100"
                value={strength}
                aria-label="效果强度"
                style={{ "--range-value": `${strength}%` } as React.CSSProperties}
                onChange={(event) => setStrength(Number(event.target.value))}
              />
              <div className="range-labels"><span>自然</span><span>强烈</span></div>
            </div>
          )}

          <div className="panel-footer">
            <button className="reset-button" onClick={resetAdjustments} title="重置设置">
              <RotateCcw size={17} />
            </button>
            <button
              className="generate-button"
              onClick={() => void processImage()}
              disabled={isSubmittingTask}
            >
              <WandSparkles size={18} />
              {isSubmittingTask
                ? "正在提交后台任务..."
                : canGenerate()
                  ? isBatchMode
                    ? `${generateButtonText} · ${sourceImages.length} 张`
                    : generateButtonText
                  : missingUploadText}
              <span>{MODELS.find(m => m.id === selectedModelId)?.name}</span>
            </button>
          </div>
        </aside>
      </div>

      {backgroundPresetEditDraft && (
        <div
          className="settings-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeBackgroundPresetEditor();
          }}
        >
          <section
            className="background-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="background-editor-title"
          >
            <div className="settings-dialog-header">
              <span className="settings-dialog-icon"><Pencil size={19} /></span>
              <div>
                <h2 id="background-editor-title">编辑候选背景</h2>
                <p>更换参考图片，或调整候选名称与默认提示词</p>
              </div>
              <button
                className="settings-close"
                type="button"
                onClick={closeBackgroundPresetEditor}
                aria-label="关闭候选背景编辑"
              >
                <X size={18} />
              </button>
            </div>
            <form className="background-editor-form" onSubmit={saveBackgroundPresetEdit}>
              <div className="background-editor-image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={backgroundPresetEditDraft.previewUrl} alt="候选背景预览" />
                <label>
                  <Upload size={14} />
                  更换背景参考图
                  <input
                    className="sr-only"
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES.join(",")}
                    onChange={handleBackgroundPresetImage}
                  />
                </label>
                <small>JPG、PNG、WebP，最大 15 MB；保存后自动生成缩略图</small>
              </div>

              <div className="background-editor-fields">
                <label className="settings-field">
                  <span>名称</span>
                  <input
                    autoFocus
                    maxLength={60}
                    value={backgroundPresetEditDraft.title}
                    onChange={(event) => setBackgroundPresetEditDraft((current) =>
                      current ? { ...current, title: event.target.value } : current
                    )}
                  />
                </label>
                <label className="settings-field">
                  <span>地点</span>
                  <input
                    maxLength={100}
                    value={backgroundPresetEditDraft.location}
                    onChange={(event) => setBackgroundPresetEditDraft((current) =>
                      current ? { ...current, location: event.target.value } : current
                    )}
                  />
                </label>
                <label className="settings-field">
                  <span>简介</span>
                  <input
                    maxLength={180}
                    value={backgroundPresetEditDraft.summary}
                    onChange={(event) => setBackgroundPresetEditDraft((current) =>
                      current ? { ...current, summary: event.target.value } : current
                    )}
                  />
                </label>
                <label className="settings-field background-editor-prompt-field">
                  <span>默认用户提示词</span>
                  <textarea
                    maxLength={500}
                    value={backgroundPresetEditDraft.prompt}
                    onChange={(event) => setBackgroundPresetEditDraft((current) =>
                      current ? { ...current, prompt: event.target.value } : current
                    )}
                  />
                  <small>{backgroundPresetEditDraft.prompt.length}/500 · 只填写地点与落位要求，身份保护和基本融合由系统提供</small>
                </label>
              </div>

              {error && <p className="settings-error" role="alert">{error}</p>}
              <div className="background-editor-actions">
                <button type="button" onClick={closeBackgroundPresetEditor}>
                  取消
                </button>
                <button className="primary" type="submit" disabled={isSavingBackgroundPreset}>
                  {isSavingBackgroundPreset ? "保存中…" : "保存修改"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {historyOpen && (
        <div
          className="settings-backdrop history-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setHistoryOpen(false);
          }}
        >
          <section
            className="history-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
          >
            <div className="history-dialog-header">
              <span className="settings-dialog-icon"><HistoryIcon size={20} /></span>
              <div>
                <h2 id="history-title">生成历史</h2>
                <p>保留最近 {historyLimit} 条结果，可重新查看和下载</p>
              </div>
              <div className="history-dialog-actions">
                <button
                  type="button"
                  onClick={() => void loadHistory()}
                  disabled={historyLoading}
                  aria-label="刷新历史记录"
                  title="刷新历史记录"
                >
                  <RefreshCw className={historyLoading ? "is-spinning" : ""} size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  aria-label="关闭历史记录"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="history-dialog-body">
              {historyLoading && historyItems.length === 0 ? (
                <div className="history-empty-state">
                  <RefreshCw className="is-spinning" size={22} />
                  <strong>正在读取历史记录</strong>
                </div>
              ) : historyError ? (
                <div className="history-empty-state" role="alert">
                  <strong>历史记录暂时无法读取</strong>
                  <span>{historyError}</span>
                  <button type="button" onClick={() => void loadHistory()}>重新加载</button>
                </div>
              ) : historyItems.length === 0 ? (
                <div className="history-empty-state">
                  <HistoryIcon size={24} />
                  <strong>还没有生成记录</strong>
                  <span>成功生成的图片会自动保存在这里</span>
                </div>
              ) : (
                <div className="history-layout">
                  <div className="history-list" aria-label="历史记录列表">
                    {historyItems.map((item) => {
                      const modelName =
                        MODELS.find((model) => model.id === item.modelId)?.name ??
                        item.modelId;
                      return (
                        <button
                          key={item.id}
                          className="history-list-item"
                          type="button"
                          aria-pressed={selectedHistoryItem?.id === item.id}
                          onClick={() => setSelectedHistoryId(item.id)}
                        >
                          <span className="history-list-thumbnail">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.imageUrl} alt="" loading="lazy" />
                          </span>
                          <span className="history-list-copy">
                            <strong>{item.sourceFileName}</strong>
                            <small>{modelName} · {formatHistoryDate(item.createdAt)}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedHistoryItem && (
                    <article className="history-preview">
                      <div className="history-preview-image">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={selectedHistoryItem.imageUrl}
                          alt={`${selectedHistoryItem.sourceFileName} 的历史生成结果`}
                        />
                      </div>
                      <div className="history-preview-details">
                        <div className="history-preview-heading">
                          <div>
                            <strong>{selectedHistoryItem.sourceFileName}</strong>
                            <small>{formatHistoryDate(selectedHistoryItem.createdAt)}</small>
                          </div>
                          <span>
                            {MODELS.find((model) => model.id === selectedHistoryItem.modelId)?.name ?? selectedHistoryItem.modelId}
                          </span>
                        </div>
                        <p>{selectedHistoryItem.prompt}</p>
                        {WARDROBE_FEATURE_ENABLED && selectedHistoryItem.wardrobePrompt && (
                          <p className="history-wardrobe-prompt">
                            <strong>服装积木：</strong>
                            {selectedHistoryItem.wardrobePrompt}
                          </p>
                        )}
                        <div className="history-preview-meta">
                          {supportsCreativeGuidance(selectedHistoryItem.modelId) && (
                            <span>强度 {selectedHistoryItem.strength}%</span>
                          )}
                          {WARDROBE_FEATURE_ENABLED && selectedHistoryItem.wardrobeTitle && (
                            <span>服装：{selectedHistoryItem.wardrobeTitle}</span>
                          )}
                          {selectedHistoryItem.size && <span>{selectedHistoryItem.size}</span>}
                          <span>{formatHistoryBytes(selectedHistoryItem.byteSize)}</span>
                        </div>
                        <div className="history-preview-actions">
                          <a
                            href={selectedHistoryItem.imageUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            查看原图
                          </a>
                          <a
                            className="primary"
                            href={selectedHistoryItem.downloadUrl}
                            download
                            onClick={() => setToast("历史图片开始下载")}
                          >
                            <ArrowDownToLine size={15} />下载原图
                          </a>
                        </div>
                      </div>
                    </article>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div
          className="settings-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="settings-dialog-header">
              <span className="settings-dialog-icon"><Settings size={20} /></span>
              <div>
                <h2 id="settings-title">火山方舟设置</h2>
                <p>
                  {imageProviderStatus?.backgroundReplaceProvider !== "ark"
                    ? `用于 Paper Collage 与平面剪纸；背景替换使用服务端 ${
                        imageProviderStatus?.backgroundReplaceProvider === "youpai"
                          ? "YouPai"
                          : imageProviderStatus?.backgroundReplaceProvider === "apimodels"
                            ? "APIMODELS"
                            : "Lovart"
                      } 配置`
                    : "配置图片生成模型"}
                </p>
              </div>
              <button
                className="settings-close"
                onClick={() => setSettingsOpen(false)}
                aria-label="关闭设置"
              >
                <X size={18} />
              </button>
            </div>

            <form className="settings-form" onSubmit={saveSettings}>
              <Link className="backend-settings-link" href="/settings">
                <ServerCog size={16} />
                <span>
                  <strong>后台服务配置</strong>
                  <small>选择 Ark / YouPai / APIMODELS，并在服务端保存独立密钥与模型参数</small>
                </span>
              </Link>
              <label className="settings-field">
                <span><KeyRound size={14} />API Key</span>
                <div className="secret-input">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={settingsDraft.apiKey}
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="输入火山方舟 API Key"
                    onChange={(event) => {
                      setSettingsDraft((current) => ({
                        ...current,
                        apiKey: event.target.value,
                      }));
                      setSettingsError("");
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((visible) => !visible)}
                    aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              <label className="settings-field">
                <span>图片模型</span>
                <input
                  type="text"
                  value={settingsDraft.imageModel}
                  spellCheck={false}
                  placeholder="Seedream Model ID 或 Endpoint ID"
                  onChange={(event) => setSettingsDraft((current) => ({
                    ...current,
                    imageModel: event.target.value,
                  }))}
                />
                <small>Paper Collage 与平面剪纸使用此模型；背景替换按服务端 Provider 配置</small>
              </label>

              <label className="remember-setting">
                <input
                  type="checkbox"
                  checked={rememberSettings}
                  onChange={(event) => setRememberSettings(event.target.checked)}
                />
                <span>
                  <strong>在此浏览器中记住</strong>
                  <small>关闭后仅在当前标签页会话中保留</small>
                </span>
              </label>

              <div className="settings-security-note">
                <ShieldCheck size={16} />
                <span>密钥仅存储在你的浏览器中，并通过本应用后端转发给火山方舟。共享设备不建议勾选记住。</span>
              </div>

              {settingsError && (
                <p className="settings-error" role="alert">{settingsError}</p>
              )}

              <div className="settings-actions">
                <button
                  className="clear-settings-button"
                  type="button"
                  onClick={clearSettings}
                >
                  清除前端配置
                </button>
                <button className="save-settings-button" type="submit">
                  <Check size={16} />保存设置
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {completionNotice && (
        <div className="task-completion-notice" role="status">
          <span className={completionNotice.canOpenHistory ? "success" : "failed"}>
            {completionNotice.canOpenHistory ? <Check size={16} /> : <X size={16} />}
          </span>
          <div>
            <strong>{completionNotice.canOpenHistory ? "后台任务已完成" : "后台任务未完成"}</strong>
            <small>{completionNotice.message}</small>
          </div>
          {completionNotice.canOpenHistory && (
            <button type="button" onClick={openCompletedTaskHistory}>
              查看历史
            </button>
          )}
          <button
            className="task-notice-close"
            type="button"
            onClick={() => setCompletionNotice(null)}
            aria-label="关闭任务提示"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </main>
  );
}
