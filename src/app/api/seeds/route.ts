import { prisma } from "@/lib/prisma";
import { SEED_CATEGORIES } from "@/data/seeds";

export const dynamic = "force-dynamic";

export async function GET() {
  const visitedConcepts = await prisma.concept.findMany({
    select: { word: true },
  });
  const visitedSet = new Set(visitedConcepts.map((c) => c.word));

  let totalVisited = 0;
  let totalWords = 0;

  const categories = SEED_CATEGORIES.map((cat) => {
    const seeds = cat.words.map((word) => {
      const visited = visitedSet.has(word);
      if (visited) totalVisited++;
      totalWords++;
      return { word, visited };
    });
    return {
      category: cat.category,
      emoji: cat.emoji,
      seeds,
    };
  });

  return Response.json({
    categories,
    stats: {
      total: totalWords,
      visited: totalVisited,
      remaining: totalWords - totalVisited,
    },
  });
}
