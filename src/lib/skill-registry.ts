import { SkillMetadata } from "@/lib/skill-types";
import matter from "gray-matter";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_SIZE = 64 * 1024;
const MAX_DESCRIPTION_LENGTH = 800;
const MAX_DETAIL_LENGTH = 50_000;
const MAX_RESOLVED_DETAIL_LENGTH = 64_000;
const SKILLS_ROOT = path.join(process.cwd(), ".trae", "skills");

export type SkillDefinition = SkillMetadata & {
  detail: string;
};

export class SkillRegistryError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "SkillRegistryError";
  }
}

export function parseSkillDocument(content: string): SkillDefinition {
  if (!content.trim()) throw new SkillRegistryError("Skill 文件不能为空");
  if (Buffer.byteLength(content, "utf8") > MAX_SKILL_SIZE) {
    throw new SkillRegistryError("Skill 文件不能超过 64 KB");
  }

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    throw new SkillRegistryError("Skill frontmatter 格式无效");
  }

  const name =
    typeof parsed.data.name === "string" ? parsed.data.name.trim() : "";
  const description =
    typeof parsed.data.description === "string"
      ? parsed.data.description.trim()
      : "";
  const detail = parsed.content.trim();

  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new SkillRegistryError(
      "Skill name 只能包含小写字母、数字和单个连字符",
    );
  }
  if (!description || description.length > MAX_DESCRIPTION_LENGTH) {
    throw new SkillRegistryError("Skill description 必须为 1-800 个字符");
  }
  if (!detail || detail.length > MAX_DETAIL_LENGTH) {
    throw new SkillRegistryError("Skill 正文必须为 1-50000 个字符");
  }

  return { name, description, detail };
}

async function readSkillFile(filePath: string) {
  const skill = parseSkillDocument(await readFile(filePath, "utf8"));
  const skillDirectory = path.dirname(filePath);
  const references = [
    ...skill.detail.matchAll(/\]\((references\/[a-z0-9._/-]+\.md)\)/gi),
  ]
    .map((match) => match[1])
    .filter((reference, index, all) => all.indexOf(reference) === index);

  const referenceDetails = await Promise.all(
    references.map(async (reference) => {
      const referencePath = path.resolve(skillDirectory, reference);
      const referenceRoot = path.resolve(skillDirectory, "references");
      if (!referencePath.startsWith(`${referenceRoot}${path.sep}`)) {
        return "";
      }
      try {
        const content = (await readFile(referencePath, "utf8")).trim();
        return content ? `\n\n## Reference: ${reference}\n\n${content}` : "";
      } catch {
        return "";
      }
    }),
  );

  const detail = `${skill.detail}${referenceDetails.join("")}`;
  return {
    ...skill,
    detail: detail.slice(0, MAX_RESOLVED_DETAIL_LENGTH),
  };
}

export async function listSkillDefinitions(): Promise<SkillDefinition[]> {
  let entries;
  try {
    entries = await readdir(SKILLS_ROOT, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const skills = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() && SKILL_NAME_PATTERN.test(entry.name),
      )
      .map(async (entry) => {
        try {
          const skill = await readSkillFile(
            path.join(SKILLS_ROOT, entry.name, "SKILL.md"),
          );
          return skill.name === entry.name ? skill : null;
        } catch {
          return null;
        }
      }),
  );

  return skills
    .filter((skill): skill is SkillDefinition => skill !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function listSkillMetadata(): Promise<SkillMetadata[]> {
  return (await listSkillDefinitions()).map(({ name, description }) => ({
    name,
    description,
  }));
}

export async function importSkillDocument(content: string) {
  const skill = parseSkillDocument(content);
  const skillDirectory = path.join(SKILLS_ROOT, skill.name);

  await mkdir(SKILLS_ROOT, { recursive: true });
  try {
    await mkdir(skillDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new SkillRegistryError(`Skill @${skill.name} 已存在`, 409);
    }
    throw error;
  }

  try {
    await writeFile(path.join(skillDirectory, "SKILL.md"), content, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    await rm(skillDirectory, { recursive: true, force: true });
    throw error;
  }

  return { name: skill.name, description: skill.description };
}

export function extractExplicitSkillNames(prompt: string) {
  const names = new Set<string>();
  for (const match of prompt.matchAll(/@([a-z0-9]+(?:-[a-z0-9]+)*)\b/g)) {
    names.add(match[1]);
  }
  return [...names];
}

export function assertExplicitSkillsExist(
  explicitNames: string[],
  skills: SkillMetadata[],
) {
  const available = new Set(skills.map((skill) => skill.name));
  const unknown = explicitNames.filter((name) => !available.has(name));
  if (unknown.length > 0) {
    throw new SkillRegistryError(
      `未找到 Skill：${unknown.map((name) => `@${name}`).join("、")}`,
    );
  }
}
