import {
  importSkillDocument,
  listSkillMetadata,
  SkillRegistryError,
} from "@/lib/skill-registry";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_SKILL_FILE_SIZE = 64 * 1024;

export async function GET() {
  return NextResponse.json({ skills: await listSkillMetadata() });
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "请求必须使用 multipart/form-data" },
      { status: 400 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("skill");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "请选择 SKILL.md 文件" }, { status: 400 });
    }
    if (file.size > MAX_SKILL_FILE_SIZE) {
      return NextResponse.json({ error: "Skill 文件不能超过 64 KB" }, { status: 400 });
    }

    const skill = await importSkillDocument(await file.text());
    return NextResponse.json({ skill }, { status: 201 });
  } catch (error) {
    if (error instanceof SkillRegistryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Skill 导入失败" }, { status: 500 });
  }
}
