import {
    ArkRequestConfig,
    generateImageWithArk,
} from "@/lib/ark-provider";
import { ModelId } from "@/lib/catalog";
import {
    assertExplicitSkillsExist,
    extractExplicitSkillNames,
    listSkillDefinitions,
} from "@/lib/skill-registry";

export async function runPhotoPipeline(input: {
  file: File;
  referenceFile?: File;
  prompt: string;
  strength: number;
  config: ArkRequestConfig;
  disabledSkillNames?: string[];
  modelId: ModelId;
}) {
  const skills = await listSkillDefinitions();
  const disabledNames = new Set(input.disabledSkillNames ?? []);
  const enabledSkills = skills.filter((skill) => !disabledNames.has(skill.name));
  const explicitSkillNames = extractExplicitSkillNames(input.prompt).filter(
    (name) => !disabledNames.has(name),
  );
  assertExplicitSkillsExist(explicitSkillNames, enabledSkills);

  const selectedNames = new Set(explicitSkillNames);
  const selectedSkills = enabledSkills.filter((skill) =>
    selectedNames.has(skill.name),
  );
  const imageResult = await generateImageWithArk({
    file: input.file,
    referenceFile: input.referenceFile,
    modelId: input.modelId,
    prompt: input.prompt,
    strength: input.strength,
    config: input.config,
    skills: selectedSkills,
  });
  return {
    ...imageResult,
    modelId: input.modelId,
    skillNames: explicitSkillNames,
  };
}
