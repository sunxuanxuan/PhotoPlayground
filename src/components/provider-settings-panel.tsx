"use client";

import {
  APIMODELS_IMAGE_MODELS,
  APIMODELS_IMAGE_QUALITIES,
  APIMODELS_OUTPUT_FORMATS,
  YOUPAI_IMAGE_MODELS,
  ApiModelsImageModel,
  ApiModelsImageQuality,
  ApiModelsOutputFormat,
  BackgroundReplaceProvider,
  ProviderSettingsView,
  YouPaiImageModel,
} from "@/lib/provider-settings-types";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type ProviderSecretDraft = {
  apiKey: string;
  clearApiKey: boolean;
  baseUrl: string;
};

type YouPaiDraft = ProviderSecretDraft & {
  model: YouPaiImageModel;
};

type ApiModelsDraft = ProviderSecretDraft & {
  model: ApiModelsImageModel;
  quality: ApiModelsImageQuality;
  outputFormat: ApiModelsOutputFormat;
};

type ProviderDraft = {
  provider: BackgroundReplaceProvider;
  youPai: YouPaiDraft;
  apiModels: ApiModelsDraft;
};

const INITIAL_DRAFT: ProviderDraft = {
  provider: "ark",
  youPai: {
    apiKey: "",
    clearApiKey: false,
    baseUrl: "https://api.youpai.de/v1",
    model: "gpt-image-2:2k",
  },
  apiModels: {
    apiKey: "",
    clearApiKey: false,
    baseUrl: "https://api.apimodels.app/v1",
    model: "gpt-image-2.5-sunburst",
    quality: "high",
    outputFormat: "png",
  },
};

function toDraft(settings: ProviderSettingsView): ProviderDraft {
  return {
    provider: settings.backgroundReplaceProvider,
    youPai: {
      apiKey: "",
      clearApiKey: false,
      baseUrl: settings.youPai.baseUrl,
      model: settings.youPai.model,
    },
    apiModels: {
      apiKey: "",
      clearApiKey: false,
      baseUrl: settings.apiModels.baseUrl,
      model: settings.apiModels.model,
      quality: settings.apiModels.quality,
      outputFormat: settings.apiModels.outputFormat,
    },
  };
}

async function readSettingsResponse(response: Response) {
  const result = (await response.json()) as ProviderSettingsView & {
    error?: string;
  };
  if (!response.ok) throw new Error(result.error ?? "后台服务配置读取失败");
  return result;
}

export function ProviderSettingsPanel() {
  const [settings, setSettings] = useState<ProviderSettingsView | null>(null);
  const [draft, setDraft] = useState<ProviderDraft>(INITIAL_DRAFT);
  const [adminToken, setAdminToken] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAdminToken, setShowAdminToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/provider-settings", { cache: "no-store" })
      .then(readSettingsResponse)
      .then((result) => {
        if (cancelled) return;
        setSettings(result);
        setDraft(toDraft(result));
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "后台服务配置读取失败",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function managementHeaders(): Record<string, string> {
    return adminToken.trim()
      ? { "x-playground-admin-token": adminToken.trim() }
      : {};
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (draft.provider === "lovart") {
      setError(
        "Lovart 仅保留环境变量兼容；请改选 Ark、YouPai 或 APIMODELS 后再保存",
      );
      return;
    }
    if (
      draft.provider === "youpai" &&
      !draft.youPai.apiKey.trim() &&
      !settings?.youPai.apiKeyConfigured
    ) {
      setError("启用 YouPai 前需要填写 API Key");
      return;
    }
    if (
      draft.provider === "apimodels" &&
      !draft.apiModels.apiKey.trim() &&
      !settings?.apiModels.apiKeyConfigured
    ) {
      setError("启用 APIMODELS 前需要填写 API Key");
      return;
    }
    if (
      draft.youPai.apiKey.length > 512 ||
      draft.apiModels.apiKey.length > 512
    ) {
      setError("API Key 长度不能超过 512 个字符");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/provider-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...managementHeaders(),
        },
        body: JSON.stringify({
          backgroundReplaceProvider: draft.provider,
          youPai: {
            ...(draft.youPai.apiKey.trim()
              ? { apiKey: draft.youPai.apiKey.trim() }
              : {}),
            clearApiKey: draft.youPai.clearApiKey,
            baseUrl: draft.youPai.baseUrl,
            model: draft.youPai.model,
          },
          apiModels: {
            ...(draft.apiModels.apiKey.trim()
              ? { apiKey: draft.apiModels.apiKey.trim() }
              : {}),
            clearApiKey: draft.apiModels.clearApiKey,
            baseUrl: draft.apiModels.baseUrl,
            model: draft.apiModels.model,
            quality: draft.apiModels.quality,
            outputFormat: draft.apiModels.outputFormat,
          },
        }),
      });
      const result = await readSettingsResponse(response);
      setSettings(result);
      setDraft(toDraft(result));
      setShowApiKey(false);
      setNotice(
        result.backgroundReplaceProvider === "youpai"
          ? "YouPai 后台配置已保存，背景替换现已使用 YouPai"
          : result.backgroundReplaceProvider === "apimodels"
            ? "APIMODELS 后台配置已保存，背景替换现已使用 APIMODELS"
            : "后台配置已保存，背景替换现已使用 Ark",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "后台服务配置保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function resetSettings() {
    if (!window.confirm("确认删除后台界面保存的配置，并恢复为环境变量或默认值吗？")) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/provider-settings", {
        method: "DELETE",
        headers: managementHeaders(),
      });
      const result = await readSettingsResponse(response);
      setSettings(result);
      setDraft(toDraft(result));
      setNotice("已删除后台界面配置，并恢复环境变量或默认配置");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "后台服务配置重置失败");
    } finally {
      setSaving(false);
    }
  }

  const providerLabel = settings?.backgroundReplaceProvider === "youpai"
    ? "YouPai"
    : settings?.backgroundReplaceProvider === "apimodels"
      ? "APIMODELS"
      : settings?.backgroundReplaceProvider === "lovart"
        ? "Lovart（旧配置）"
        : "火山方舟 Ark";

  const usesApiModelsDraft = draft.provider === "apimodels";
  const usesYouPaiDraft = draft.provider === "youpai";
  const usesOpenAiProviderDraft = usesYouPaiDraft || usesApiModelsDraft;
  const activeProviderDraft = usesApiModelsDraft
    ? draft.apiModels
    : draft.youPai;
  const activeProviderSettings = usesApiModelsDraft
    ? settings?.apiModels
    : settings?.youPai;
  const activeProviderName = usesApiModelsDraft ? "APIMODELS" : "YouPai";

  function updateActiveProviderSecret(update: Partial<ProviderSecretDraft>) {
    setDraft((current) => current.provider === "apimodels"
      ? {
          ...current,
          apiModels: { ...current.apiModels, ...update },
        }
      : {
          ...current,
          youPai: { ...current.youPai, ...update },
        });
  }

  return (
    <main className="provider-settings-page">
      <header className="provider-settings-topbar">
        <Link href="/" className="provider-settings-back">
          <ArrowLeft size={16} />返回工作台
        </Link>
        <div className="provider-settings-brand">
          <span><ServerCog size={18} /></span>
          后台服务配置
        </div>
        <div className="provider-settings-current">
          当前：<strong>{providerLabel}</strong>
        </div>
      </header>

      <div className="provider-settings-layout">
        <section className="provider-settings-intro">
          <p className="eyebrow">PROVIDER CONTROL</p>
          <h1>背景替换服务</h1>
          <p>
            在 Ark、YouPai 与 APIMODELS 之间明确选择。聚合供应商只接管背景替换，其他创作模式继续使用 Ark，系统不会在失败时自动切换服务商。
          </p>
          <div className="provider-settings-summary">
            <span className={settings?.youPai.apiKeyConfigured ? "ready" : ""} />
            <div>
              <strong>
                {settings?.youPai.apiKeyConfigured
                  ? "YouPai 密钥已配置"
                  : "YouPai 密钥尚未配置"}
              </strong>
              <small>
                {settings?.youPai.apiKeySource === "stored"
                  ? "来源：仅当前系统用户可读的权限文件（0600）"
                  : settings?.youPai.apiKeySource === "environment"
                    ? "来源：YOUPAI_API_KEY 环境变量"
                    : "填写密钥后才能启用 YouPai"}
              </small>
            </div>
          </div>
          <div className="provider-settings-summary">
            <span className={settings?.apiModels.apiKeyConfigured ? "ready" : ""} />
            <div>
              <strong>
                {settings?.apiModels.apiKeyConfigured
                  ? "APIMODELS 密钥已配置"
                  : "APIMODELS 密钥尚未配置"}
              </strong>
              <small>
                {settings?.apiModels.apiKeySource === "stored"
                  ? "来源：仅当前系统用户可读的权限文件（0600）"
                  : settings?.apiModels.apiKeySource === "environment"
                    ? "来源：APIMODELS_API_KEY 环境变量"
                    : "填写密钥后才能启用 APIMODELS"}
              </small>
            </div>
          </div>
        </section>

        <section className="provider-settings-card" aria-busy={loading || saving}>
          <div className="provider-settings-card-header">
            <div>
              <h2>图片服务参数</h2>
              <p>保存只更新配置，不会发送图片或触发计费请求。</p>
            </div>
            {settings && (
              <span className="provider-source-badge">
                {settings.providerSource === "stored"
                  ? "后台配置"
                  : settings.providerSource === "environment"
                    ? "环境变量"
                    : "默认值"}
              </span>
            )}
          </div>

          {loading ? (
            <div className="provider-settings-loading">
              <Sparkles size={18} />正在读取后台配置…
            </div>
          ) : (
            <form className="provider-settings-form" onSubmit={saveSettings}>
              <fieldset className="provider-choice-group">
                <legend>背景替换 Provider</legend>
                <button
                  type="button"
                  className={draft.provider === "ark" ? "selected" : ""}
                  onClick={() => setDraft((current) => ({ ...current, provider: "ark" }))}
                >
                  <span className="provider-choice-icon ark">A</span>
                  <span>
                    <strong>火山方舟 Ark</strong>
                    <small>继续使用本地 Seedream 配置</small>
                  </span>
                  {draft.provider === "ark" && <Check size={16} />}
                </button>
                <button
                  type="button"
                  className={draft.provider === "youpai" ? "selected" : ""}
                  onClick={() => {
                    setDraft((current) => ({ ...current, provider: "youpai" }));
                    setShowApiKey(false);
                  }}
                >
                  <span className="provider-choice-icon youpai">Y</span>
                  <span>
                    <strong>YouPai · GPT Image 2</strong>
                    <small>1K / 2K / 4K 分档的 OpenAI Compatible 接口</small>
                  </span>
                  {draft.provider === "youpai" && <Check size={16} />}
                </button>
                <button
                  type="button"
                  className={draft.provider === "apimodels" ? "selected" : ""}
                  onClick={() => {
                    setDraft((current) => ({ ...current, provider: "apimodels" }));
                    setShowApiKey(false);
                  }}
                >
                  <span className="provider-choice-icon apimodels">M</span>
                  <span>
                    <strong>APIMODELS · GPT Image</strong>
                    <small>OpenAI 兼容同步多图编辑接口</small>
                  </span>
                  {draft.provider === "apimodels" && <Check size={16} />}
                </button>
              </fieldset>

              {settings?.backgroundReplaceProvider === "lovart" && (
                <div className="provider-settings-warning">
                  当前环境变量仍指定 Lovart。Lovart 不在此页面继续配置；选择 Ark、YouPai 或 APIMODELS 并保存后会覆盖它。
                </div>
              )}

              {usesOpenAiProviderDraft && (
                <div className="provider-detail-section">
                <div className="provider-detail-heading">
                  <div>
                    <strong>{activeProviderName} 图片编辑</strong>
                    <small>
                      {usesApiModelsDraft
                        ? "使用 images/edits SSE 保活流，私密上传参考图并避免普通长连接断开"
                        : "按 YouPai Base URL、Bearer 密钥和实时模型 ID 接入；双图编辑不会降级成文生图"}
                    </small>
                  </div>
                  <span>{activeProviderSettings?.apiKeyConfigured ? "已配置" : "待配置"}</span>
                </div>

                <label className="provider-form-field provider-form-field-wide">
                  <span><KeyRound size={14} />API Key</span>
                  <div className="provider-secret-input">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={activeProviderDraft.apiKey}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={
                        activeProviderSettings?.apiKeyConfigured
                          ? "已配置；留空保持原密钥"
                          : `输入 ${activeProviderName} API Key`
                      }
                      onChange={(event) => {
                        updateActiveProviderSecret({
                          apiKey: event.target.value,
                          clearApiKey: false,
                        });
                        setError("");
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
                  {activeProviderSettings?.apiKeySource === "stored" && (
                    <label className="provider-inline-check">
                      <input
                        type="checkbox"
                        checked={activeProviderDraft.clearApiKey}
                        onChange={(event) => updateActiveProviderSecret({
                          clearApiKey: event.target.checked,
                          apiKey: event.target.checked
                            ? ""
                            : activeProviderDraft.apiKey,
                        })}
                      />
                      保存时删除后台文件中的 {activeProviderName} 密钥
                    </label>
                  )}
                </label>

                <label className="provider-form-field provider-form-field-wide">
                  <span>Base URL</span>
                  <input
                    value={activeProviderDraft.baseUrl}
                    spellCheck={false}
                    onChange={(event) => updateActiveProviderSecret({
                      baseUrl: event.target.value,
                    })}
                  />
                  <small>
                    安全限制为 {usesApiModelsDraft
                      ? "https://api.apimodels.app/v1"
                      : "https://api.youpai.de/v1"}
                  </small>
                </label>

                <label className="provider-form-field provider-form-field-wide">
                  <span>图片编辑模型</span>
                  {usesApiModelsDraft ? (
                    <select
                      value={draft.apiModels.model}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        apiModels: {
                          ...current.apiModels,
                          model: event.target.value as ApiModelsImageModel,
                          quality:
                            event.target.value === "gpt-image-2" &&
                            (current.apiModels.quality === "xhigh" ||
                              current.apiModels.quality === "max")
                              ? "high"
                              : current.apiModels.quality,
                        },
                      }))}
                    >
                      {APIMODELS_IMAGE_MODELS.map((model) => (
                        <option value={model} key={model}>{model}</option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={draft.youPai.model}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        youPai: {
                          ...current.youPai,
                          model: event.target.value as YouPaiImageModel,
                        },
                      }))}
                    >
                      {YOUPAI_IMAGE_MODELS.map((model) => (
                        <option value={model} key={model}>{model}</option>
                      ))}
                    </select>
                  )}
                  <small>
                    {usesApiModelsDraft
                      ? "Sunburst 精度优先；Flare 延迟更低，适合批量处理"
                      : "模型 ID 同时选择 1K、2K 或 4K 计费档位；默认 2K，价格以 YouPai 控制台为准"}
                  </small>
                </label>

                {usesApiModelsDraft && (
                  <>
                  <label className="provider-form-field">
                    <span>质量与计费档位</span>
                    <select
                      value={draft.apiModels.quality}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        apiModels: {
                          ...current.apiModels,
                          quality: event.target.value as ApiModelsImageQuality,
                        },
                      }))}
                    >
                      {APIMODELS_IMAGE_QUALITIES.map((quality) => (
                        <option
                          value={quality}
                          key={quality}
                          disabled={
                            draft.apiModels.model === "gpt-image-2" &&
                            (quality === "xhigh" || quality === "max")
                          }
                        >
                          {quality}
                        </option>
                      ))}
                    </select>
                    <small>默认 high；xhigh / max 成本显著增加</small>
                  </label>

                  <label className="provider-form-field">
                    <span>输出格式</span>
                    <select
                      value={draft.apiModels.outputFormat}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        apiModels: {
                          ...current.apiModels,
                          outputFormat: event.target.value as ApiModelsOutputFormat,
                        },
                      }))}
                    >
                      {APIMODELS_OUTPUT_FORMATS.map((format) => (
                        <option value={format} key={format}>{format}</option>
                      ))}
                    </select>
                    <small>按官网契约请求 PNG / WebP / JPEG，不附加未公开的压缩参数</small>
                  </label>
                  </>
                )}

                <div className="provider-api-contract">
                  <ShieldCheck size={17} />
                  <span>
                    {usesApiModelsDraft
                      ? <>服务端读取背景图校正方向后的比例，以 2K multipart 提交 <code>POST /v1/images/edits</code>，并持续读取 SSE 保活和完成事件；用户不能覆盖画幅。</>
                      : <>服务端以 Bearer 密钥将人物图和背景图按顺序提交到 OpenAI Compatible <code>POST /v1/images/edits</code>，并要求 Base64 结果；密钥不会返回浏览器。</>}
                  </span>
                </div>
                </div>
              )}

              {settings?.management.requiresAdminToken && (
                <label className="provider-form-field provider-form-field-wide admin-token-field">
                  <span><LockKeyhole size={14} />后台管理口令</span>
                  <div className="provider-secret-input">
                    <input
                      type={showAdminToken ? "text" : "password"}
                      value={adminToken}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="输入 PROVIDER_SETTINGS_ADMIN_TOKEN"
                      onChange={(event) => setAdminToken(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowAdminToken((visible) => !visible)}
                      aria-label={showAdminToken ? "隐藏管理口令" : "显示管理口令"}
                    >
                      {showAdminToken ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <small>只随本次保存请求发送，不写入浏览器存储</small>
                </label>
              )}

              {!settings?.management.requiresAdminToken && (
                <div className="provider-local-only-note">
                  <LockKeyhole size={15} />未设置管理口令，因此后台配置只能从 localhost 修改。
                </div>
              )}

              {error && <p className="provider-settings-error" role="alert">{error}</p>}
              {notice && <p className="provider-settings-notice" role="status"><Check size={14} />{notice}</p>}

              <div className="provider-settings-actions">
                <button
                  type="button"
                  className="provider-reset-button"
                  onClick={() => void resetSettings()}
                  disabled={saving}
                >
                  <RotateCcw size={15} />恢复环境变量
                </button>
                <button
                  type="submit"
                  className="provider-save-button"
                  disabled={saving}
                >
                  {saving ? "保存中…" : <><Check size={16} />保存后台配置</>}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
