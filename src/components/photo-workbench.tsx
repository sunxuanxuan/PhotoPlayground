"use client";

import {
  ARK_SETTINGS_STORAGE_KEY,
  ArkClientSettings,
  createArkRequestHeaders,
  DEFAULT_ARK_CLIENT_SETTINGS,
} from "@/lib/ark-client-config";
import { ModelId, MODELS } from "@/lib/catalog";
import { SkillMetadata } from "@/lib/skill-types";
import {
  ArrowDownToLine,
  AtSign,
  Check,
  Eye,
  EyeOff,
  FileUp,
  ImagePlus,
  KeyRound,
  RotateCcw,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
  SyntheticEvent,
  useEffect,
  useRef,
  useState,
} from "react";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const DISABLED_SKILLS_STORAGE_KEY = "photo-playground-disabled-skills";

type Status = "empty" | "ready" | "processing" | "complete";

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

export function PhotoWorkbench() {
  const inputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const skillFileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [isReferenceOnTop, setIsReferenceOnTop] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [status, setStatus] = useState<Status>("empty");
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

  const isBackgroundReplace = selectedModelId === "background-replace";
  const hasBrowserConfig = Boolean(arkSettings.apiKey);
  const availableSkillNameSet = new Set(skills.map((skill) => skill.name));
  const activeDisabledSkillNames =
    skills.length > 0
      ? disabledSkillNames.filter((name) => availableSkillNameSet.has(name))
      : disabledSkillNames;
  const disabledSkillSet = new Set(activeDisabledSkillNames);

  // Build the combined menu items: skills + image refs
  const imageRefItems: Array<{ id: string; label: string; desc: string }> = [];
  if (file) {
    imageRefItems.push({
      id: "图1",
      label: "图1",
      desc: isBackgroundReplace ? "引用主体图" : "引用已上传的主图",
    });
  }
  if (referenceFile) {
    imageRefItems.push({
      id: "图2",
      label: "图2",
      desc: isBackgroundReplace ? "引用背景参考图" : "引用已上传的参考图",
    });
  }

  const filteredSkills = skills
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

  const firstEnabledFilteredSkill = filteredSkills.find(
    (skill) => !disabledSkillSet.has(skill.name),
  );

  // Separate cleanup for sourceUrl and referenceUrl to avoid cross-revocation
  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);

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
    if (!settingsOpen) return;
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setSettingsOpen(false);
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [settingsOpen]);

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
    setSettingsDraft(arkSettings);
    setSettingsError("");
    setShowApiKey(false);
    setSettingsOpen(true);
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

  function acceptFile(nextFile: File | undefined) {
    setError("");
    if (!nextFile) return;
    if (!ACCEPTED_TYPES.includes(nextFile.type)) {
      setError("仅支持 JPG、PNG 和 WebP 图片");
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setError("图片大小不能超过 15 MB");
      return;
    }

    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setFile(nextFile);
    setSourceUrl(URL.createObjectURL(nextFile));
    setIsReferenceOnTop(false);
    setResultUrl("");
    setStatus("ready");
  }

  function acceptReferenceFile(nextFile: File | undefined) {
    setError("");
    if (!nextFile) return;
    if (!ACCEPTED_TYPES.includes(nextFile.type)) {
      setError("参考图仅支持 JPG、PNG 和 WebP 图片");
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setError("参考图大小不能超过 15 MB");
      return;
    }

    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    setReferenceFile(nextFile);
    setReferenceUrl(URL.createObjectURL(nextFile));
    setIsReferenceOnTop(false);
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleReferenceInput(event: ChangeEvent<HTMLInputElement>) {
    acceptReferenceFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
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
    const nextPrompt = `${prefix}@${text} ${prompt.slice(cursor)}`.slice(0, 500);
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
    if (!file) return false;
    if (isBackgroundReplace && !referenceFile) return false;
    return true;
  }

  async function processImage() {
    if (!file) {
      inputRef.current?.click();
      return;
    }
    if (isBackgroundReplace && !referenceFile) {
      setError("背景替换模式需要上传背景参考图");
      return;
    }
    if (!prompt.trim()) {
      setError("请先描述想要的照片效果");
      return;
    }

    setError("");
    setStatus("processing");
    const form = new FormData();
    form.set("image", file);
    if (referenceFile) {
      form.set("referenceImage", referenceFile);
    }
    form.set("prompt", prompt.trim());
    form.set("strength", String(strength));
    form.set("modelId", selectedModelId);
    form.set("disabledSkillNames", JSON.stringify(activeDisabledSkillNames));

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: createArkRequestHeaders(arkSettings),
        body: form,
      });
      const result = (await response.json()) as {
        imageUrl?: string;
        modelId?: string;
        skillNames?: string[];
        error?: string;
      };
      if (!response.ok || !result.imageUrl) {
        throw new Error(result.error ?? "图片处理失败");
      }

      setResultUrl(result.imageUrl);
      setStatus("complete");
      setToast(isBackgroundReplace ? "背景替换完成" : "方舟处理完成，可以下载或分享");
    } catch (caught) {
      setStatus("ready");
      setError(caught instanceof Error ? caught.message : "图片处理失败");
    }
  }

  async function createResultBlob() {
    if (!resultUrl) throw new Error("请先生成照片");
    const response = await fetch(resultUrl);
    if (!response.ok) throw new Error("无法读取处理结果");
    return response.blob();
  }

  async function downloadResult() {
    try {
      const blob = await createResultBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const baseName = file?.name.replace(/\.[^.]+$/, "") || "photo";
      link.href = url;
      link.download = `${baseName}-playground.${blob.type === "image/png" ? "png" : "jpg"}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast("处理结果已下载");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "下载失败");
    }
  }

  async function shareResult() {
    try {
      const blob = await createResultBlob();
      const extension = blob.type === "image/png" ? "png" : "jpg";
      const resultFile = new File([blob], `playground-result.${extension}`, {
        type: blob.type,
      });
      if (navigator.share && navigator.canShare?.({ files: [resultFile] })) {
        await navigator.share({
          title: "PlayGround 照片作品",
          text: "这是我使用 PlayGround 创作的照片",
          files: [resultFile],
        });
      } else {
        await downloadResult();
        setToast("当前浏览器不支持文件分享，已为你下载");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "分享失败");
    }
  }

  function resetAdjustments() {
    setStrength(72);
    setResultUrl("");
    setStatus(file ? "ready" : "empty");
  }

  const mainImageLabel = isBackgroundReplace ? "主体图" : "图片";
  const referenceImageLabel = isBackgroundReplace ? "背景参考图" : "参考图";
  const headerTitle = isBackgroundReplace ? "背景替换（实验中）" : "Paper Collage 拼贴海报";
  const headingTitle = isBackgroundReplace ? "把主体，融入新背景（实验功能）" : "把照片，变成拼贴海报";
  const headingSubtitle = isBackgroundReplace
    ? "上传主体照片和背景参考图，AI 将主体精确提取并合成到新背景中。此功能为实验性功能，效果取决于当前模型能力。"
    : "上传照片和参考图，描述想要的效果，AI 为你创作纸张拼贴风格作品。";
  const placeholderText = isBackgroundReplace
    ? "例如：将主体人物放入参考图的背景中，保持自然光影..."
    : "例如：@图1 旅行手账风格，撕纸开窗，复古纸张纹理...";
  const generateButtonText = isBackgroundReplace ? "替换背景" : "生成海报";
  const processingText = isBackgroundReplace ? "方舟正在替换背景（实验功能）" : "方舟正在生成拼贴海报";
  const processingSubText = isBackgroundReplace ? "Background Replace 模式处理中" : "Paper Collage 模式处理中";
  const defaultPrompt = isBackgroundReplace
    ? "将主体人物精确提取，合成到背景参考图中，保持自然光影一致。"
    : "Paper Collage 拼贴海报创作。";

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
        <button
          className={`settings-trigger ${hasBrowserConfig ? "configured" : ""}`}
          onClick={openSettings}
          aria-label="打开 API 设置"
        >
          <Settings size={16} />
          <span>设置</span>
          <i aria-hidden="true" />
        </button>
      </header>

      <div className="workspace">
        <section className="stage-panel" aria-label="照片预览区">
          <div className="stage-heading">
            <div>
              <p className="eyebrow">{isBackgroundReplace ? "BACKGROUND REPLACE" : "PAPER COLLAGE STUDIO"}</p>
              <h1>{headingTitle}</h1>
              <p className="subtitle">{headingSubtitle}</p>
            </div>
            <div className="stage-heading-actions">
              {file && (
                <button className="quiet-button" onClick={() => inputRef.current?.click()}>
                  <ImagePlus size={17} /> 更换{mainImageLabel}
                </button>
              )}
              {referenceFile && (
                <button className="quiet-button" onClick={() => referenceInputRef.current?.click()}>
                  <ImagePlus size={17} /> 更换{referenceImageLabel}
                </button>
              )}
            </div>
          </div>

          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            onChange={handleInput}
          />
          <input
            ref={referenceInputRef}
            className="sr-only"
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
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
              <h2>拖入一张照片</h2>
              <p>或点击选择本地文件</p>
              <span className="upload-meta">JPG、PNG、WebP · 最大 15 MB</span>
            </div>
          ) : (
            <div className="preview-card">
              {/* Toolbar */}
              <div className="preview-toolbar">
                <span className="toolbar-label">
                  {status === "complete" ? "生成结果" : "图片预览"}
                </span>
                <span className="file-info">{file ? `${file.name} · ${formatSize(file.size)}` : "等待上传主图"}</span>
              </div>

              {/* Image area */}
              {status === "complete" ? (
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
                        <span className="image-tag">{referenceImageLabel}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={referenceUrl} alt="参考图" className="preview-image" />
                        <button
                          className="image-remove-btn"
                          onClick={() => {
                            if (referenceUrl) URL.revokeObjectURL(referenceUrl);
                            setReferenceFile(null);
                            setReferenceUrl("");
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
                        <small>{isBackgroundReplace ? "必填" : "可选"}</small>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action bar */}
              <div className="result-actions">
                <div className="result-state">
                  {status === "complete" ? (
                    <><span className="complete-icon"><Check size={14} /></span> 已生成高清结果</>
                  ) : (
                    <><span className="live-icon" /> {resultUrl ? "效果预览" : "等待生成"}</>
                  )}
                </div>
                <div className="action-group">
                  <button className="icon-action" onClick={() => void shareResult()} aria-label="分享结果" disabled={!resultUrl}>
                    <Share2 size={17} /><span>分享</span>
                  </button>
                  <button className="icon-action primary" onClick={() => void downloadResult()} disabled={!resultUrl}>
                    <ArrowDownToLine size={17} /><span>下载</span>
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
              <div><h2>选择处理模式</h2><p>两种模式使用同一图片模型，但注入不同的处理策略</p></div>
            </div>
            <div className="model-list">
              {MODELS.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={`model-option ${selectedModelId === model.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedModelId(model.id);
                    setResultUrl("");
                    setStatus(file ? "ready" : "empty");
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

          <div className="panel-section prompt-section">
            <div className="section-title">
              <span className="step-number">02</span>
              <div><h2>描述你的想法</h2><p>输入 @ 可引用图片或调用 Skill</p></div>
            </div>
            <div className="prompt-box">
              <textarea
                ref={textareaRef}
                value={prompt}
                maxLength={500}
                onChange={handlePromptChange}
                onKeyDown={handlePromptKeyDown}
                placeholder={placeholderText}
              />
              {skillMenuOpen && (
                <div className="skill-mention-menu" role="listbox" aria-label="引用菜单">
                  <div className="skill-menu-heading">
                    <span>选择引用</span>
                    <small>{skills.length + imageRefItems.length} 个可用</small>
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
                      <p>{skills.length === 0 && imageRefItems.length === 0 ? "尚未导入 Skill 或上传图片" : "没有匹配的选项"}</p>
                    )}
                  </div>
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
                </div>
              )}
              <div className="prompt-footer">
                <div className="prompt-meta">
                  <button
                    type="button"
                    className={skillMenuOpen ? "active" : ""}
                    onClick={() => {
                      setSkillQuery("");
                      setSkillMenuOpen((open) => !open);
                      textareaRef.current?.focus();
                    }}
                    aria-label="调用 Skill 或引用图片"
                  >
                    <AtSign size={14} />引用
                  </button>
                  {activeDisabledSkillNames.length > 0 && (
                    <small className="disabled-skill-count">
                      已停用 {activeDisabledSkillNames.length}
                    </small>
                  )}
                  <span>{prompt.length}/500</span>
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
          </div>

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

          <div className="panel-footer">
            <button className="reset-button" onClick={resetAdjustments} title="重置设置">
              <RotateCcw size={17} />
            </button>
            <button
              className="generate-button"
              onClick={() => void processImage()}
              disabled={status === "processing"}
            >
              <WandSparkles size={18} />
              {status === "processing" ? "处理中..." : canGenerate() ? generateButtonText : isBackgroundReplace ? "请上传主体图和背景图" : "先上传照片"}
              <span>{MODELS.find(m => m.id === selectedModelId)?.name}</span>
            </button>
          </div>
        </aside>

        {/* Processing overlay - covers entire workspace */}
        {status === "processing" && (
          <div className="processing-layer">
            <span className="processing-orbit"><Sparkles size={24} /></span>
            <strong>{processingText}</strong>
            <span>{processingSubText}</span>
          </div>
        )}
      </div>

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
                <p>配置图片生成模型</p>
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
                <small>两种处理模式共用此 Seedream 多模态模型</small>
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

      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </main>
  );
}
