import { prisma } from "@/lib/prisma";
import { SEED_WORDS } from "@/data/seeds";

export const dynamic = "force-dynamic";

export async function GET() {
  const visitedConcepts = await prisma.concept.findMany({
    select: { word: true },
  });
  const visitedSet = new Set(visitedConcepts.map((c) => c.word));

  const seeds = SEED_WORDS.map((word) => ({
    word,
    visited: visitedSet.has(word),
  }));

  const visitedCount = seeds.filter((s) => s.visited).length;

  return Response.json({
    seeds,
    stats: {
      total: seeds.length,
      visited: visitedCount,
      remaining: seeds.length - visitedCount,
    },
  });
}
