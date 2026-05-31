import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { conceptId, content } = await req.json();

    const updatedNote = await prisma.note.upsert({
      where: { conceptId },
      update: { content },
      create: { conceptId, content },
    });

    return Response.json({ success: true, data: updatedNote });
  } catch (error) {
    console.error("笔记保存失败:", error);
    return Response.json({ error: "笔记保存失败" }, { status: 500 });
  }
}
