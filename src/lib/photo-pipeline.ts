import {
    ArkRequestConfig,
    generateImageWithArk,
} from "@/lib/ark-provider";
import { generateImageWithApiModels } from "@/lib/apimodels-provider";
import {
    isBackgroundReplaceModel,
    ModelId,
    supportsCreativeGuidance,
} from "@/lib/catalog";
import { saveGenerationHistory } from "@/lib/generation-history";
import { generateImageWithLovart } from "@/lib/lovart-provider";
import { getBackgroundReplaceProvider } from "@/lib/provider-settings-store";
import {
    assertExplicitSkillsExist,
    extractExplicitSkillNames,
    listSkillDefinitions,
    SkillRegistryError,
} from "@/lib/skill-registry";
import {
    getWardrobePrompt,
    resolveWardrobePreset,
} from "@/lib/wardrobe-presets";
import { generateImageWithYouPai } from "@/lib/youpai-provider";

type PhotoPipelineOptions = {
  referenceFile?: File;
  prompt: string;
  strength: number;
  config: ArkRequestConfig;
  disabledSkillNames?: string[];
  modelId: ModelId;
  rawPrompt?: boolean;
  wardrobePresetId?: string;
};

export async function preparePhotoPipeline(input: PhotoPipelineOptions) {
  const wardrobePreset = resolveWardrobePreset(
    input.modelId,
    input.wardrobePresetId,
  );
  const mentionedSkillNames = extractExplicitSkillNames(input.prompt);
  const supportsGuidance = supportsCreativeGuidance(input.modelId);
  if (!supportsGuidance && mentionedSkillNames.length > 0) {
    const modeMessage = input.rawPrompt && input.modelId === "background-replace"
      ? "当前背景替换会原样发送输入框内的完整提示词，不注入 Skill"
      : input.modelId === "background-replace"
        ? "背景替换只组合精简系统规则与用户要求，不注入 Skill"
        : "平面剪纸卡通是纯用户提示词模式，不会注入 Skill";
    throw new SkillRegistryError(
      `${modeMessage}；请把所需规则直接写入提示词`,
    );
  }

  const skills = supportsGuidance ? await listSkillDefinitions() : [];
  const disabledNames = new Set(input.disabledSkillNames ?? []);
  const enabledSkills = skills.filter((skill) => !disabledNames.has(skill.name));
  const explicitSkillNames = mentionedSkillNames.filter(
    (name) => !disabledNames.has(name),
  );
  assertExplicitSkillsExist(explicitSkillNames, enabledSkills);

  const selectedNames = new Set(explicitSkillNames);
  const selectedSkills = enabledSkills.filter((skill) =>
    selectedNames.has(skill.name),
  );

  return {
    ...input,
    strength: supportsGuidance ? input.strength : 0,
    selectedSkills,
    skillNames: explicitSkillNames,
    wardrobePreset,
  };
}

export type PreparedPhotoPipeline = Awaited<
  ReturnType<typeof preparePhotoPipeline>
>;

export async function runPreparedPhotoPipeline(
  file: File,
  prepared: PreparedPhotoPipeline,
) {
  const backgroundProvider = isBackgroundReplaceModel(prepared.modelId)
    ? await getBackgroundReplaceProvider()
    : "ark";
  const rawBackgroundPrompt =
    isBackgroundReplaceModel(prepared.modelId) && Boolean(prepared.rawPrompt);
  const imageResult = backgroundProvider === "lovart"
    ? await generateImageWithLovart({
        file,
        referenceFile: prepared.referenceFile!,
        prompt: prepared.prompt,
        rawPrompt: rawBackgroundPrompt,
      })
    : backgroundProvider === "youpai"
      ? await generateImageWithYouPai({
          file,
          referenceFile: prepared.referenceFile!,
          prompt: prepared.prompt,
          rawPrompt: rawBackgroundPrompt,
        })
      : backgroundProvider === "apimodels"
        ? await generateImageWithApiModels({
            file,
            referenceFile: prepared.referenceFile!,
            prompt: prepared.prompt,
            rawPrompt: rawBackgroundPrompt,
          })
      : await generateImageWithArk({
          file,
          referenceFile: prepared.referenceFile,
          modelId: prepared.modelId,
          prompt: prepared.prompt,
          strength: prepared.strength,
          config: prepared.config,
          skills: prepared.selectedSkills,
          rawPrompt: rawBackgroundPrompt,
          wardrobePrompt: prepared.wardrobePreset
            ? getWardrobePrompt(prepared.wardrobePreset)
            : undefined,
        });
  const historyItem = await saveGenerationHistory({
    imageDataUrl: imageResult.imageUrl,
    modelId: prepared.modelId,
    prompt: prepared.prompt,
    strength: prepared.strength,
    sourceFileName: file.name,
    providerModel: imageResult.providerModel,
    size: imageResult.size,
    wardrobePresetId: prepared.wardrobePreset?.id,
    wardrobeTitle: prepared.wardrobePreset?.title,
    wardrobePrompt: prepared.wardrobePreset
      ? getWardrobePrompt(prepared.wardrobePreset)
      : undefined,
  }).catch((error: unknown) => {
    console.error("[generation-history] Failed to save generated image", error);
    return undefined;
  });
  return {
    ...imageResult,
    modelId: prepared.modelId,
    skillNames: prepared.skillNames,
    historyItem,
  };
}

export async function runPhotoPipeline(
  input: PhotoPipelineOptions & { file: File },
) {
  const { file, ...options } = input;
  const prepared = await preparePhotoPipeline(options);
  return runPreparedPhotoPipeline(file, prepared);
}
