import { prisma } from "@/lib/prisma";

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/\n+/g, " ")
    .trim();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const word = url.searchParams.get("word");

  // 精确查找（用于流式后获取概念 ID）
  if (word) {
    const concept = await prisma.concept.findUnique({
      where: { word },
      include: { note: true },
    });
    return Response.json({ result: concept });
  }

  // 模糊搜索
  if (q && q.trim().length > 0) {
    const concepts = await prisma.concept.findMany({
      where: {
        word: { contains: q.trim() },
      },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        word: true,
        fullMarkdown: true,
        createdAt: true,
      },
    });

    const results = concepts.map((c) => ({
      id: c.id,
      word: c.word,
      snippet: stripMarkdown(c.fullMarkdown).slice(0, 120),
      createdAt: c.createdAt.toISOString(),
    }));

    return Response.json({ results });
  }

  return Response.json(
    { error: "缺少查询参数 q 或 word" },
    { status: 400 }
  );
}
