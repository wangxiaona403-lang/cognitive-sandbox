import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { prisma } from "@/lib/prisma";
import { SEED_WORDS } from "@/data/seeds";
import { SYSTEM_PROMPT } from "@/data/prompt";

export const maxDuration = 180; // Vercel Fluid Compute 默认 300s，留有余量

/**
 * 构建工程化硬性补充限制补丁
 */
function buildEngineeringPatch(excludeWordsList: string): string {
  return [
    "【工程化硬性补充限制】",
    `1. 你当前生成的词汇绝对不能包含在以下黑名单列表中：[${excludeWordsList}]。`,
    "2. 如果当前给定的主词汇为空，请你全网自主选择一个符合设定的全新抽象词汇。",
    "0. 【关键】你输出的第一行必须是主词汇的一级 Markdown 标题。格式：输入一个井号和一个空格，紧接着输入主词汇名称（例如\"# 幸存者偏差\"），然后空一行再开始模块一。这行标题绝对不能被省略。",
    "3. 请严格执行上述【输出模块】的 8 个模块，使用标准的 Markdown 语法进行流式输出。",
    '4. 结束“模块八”的所有内容后，请空两行，并【严格】按照以下格式输出 3-5 个与当前主词汇高度相关的专业关联词（用于系统前端标签卡片的动态高亮渲染），不要附加任何多余的解释、前言或符号：',
    "[RECOMMENDED_START]",
    "关联词1, 关联词2, 关联词3",
    "[RECOMMENDED_END]",
  ].join("\n");
}

/**
 * 从已生成文本中提取推荐词和清理后的 Markdown
 */
function extractRelatedWords(
  text: string
): { relatedWords: string; cleanMarkdown: string } {
  const recommendedRegex = /\[RECOMMENDED_START\]([\s\S]*?)\[RECOMMENDED_END\]/;
  const match = text.match(recommendedRegex);

  if (match) {
    const relatedWords = match[1].trim();
    const cleanMarkdown = text.replace(recommendedRegex, "").trim();
    return { relatedWords, cleanMarkdown };
  }

  return { relatedWords: "", cleanMarkdown: text.trim() };
}

/**
 * 从 Markdown 中提取一级标题作为词汇名称
 */
function extractWordFromMarkdown(
  markdown: string,
  fallback: string
): string {
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  return titleMatch ? titleMatch[1].trim() : fallback;
}

/**
 * 核心流处理与异步持久化入库
 */
async function executeLLMStream(
  client: ReturnType<typeof createOpenAICompatible>,
  model: string,
  systemPrompt: string,
  userWord: string,
  targetWord: string
) {
  // 预先创建概念占位（仅新建，不覆盖已有内容；确保前端 lookup 能找到记录）
  if (targetWord) {
    try {
      await prisma.concept.upsert({
        where: { word: targetWord },
        create: { word: targetWord, fullMarkdown: "", relatedWords: "" },
        update: {}, // 不覆盖已有数据，等 onFinish 再更新
      });
    } catch {
      // 占位创建失败不影响主流程
    }
  }

  const result = streamText({
    model: client(model),
    system: systemPrompt,
    maxOutputTokens: 4096,
    temperature: 0.7,
    messages: [
      {
        role: "user",
        content: userWord || "请刷新并盲抠下一个全新词汇。",
      },
    ],
    onFinish: async ({ text }) => {
      try {
        const { relatedWords, cleanMarkdown } = extractRelatedWords(text);

        if (targetWord) {
          // 始终以用户输入的词为主键更新，确保与预保存记录一致
          await prisma.concept.upsert({
            where: { word: targetWord },
            create: {
              word: targetWord,
              fullMarkdown: cleanMarkdown,
              relatedWords,
            },
            update: {
              fullMarkdown: cleanMarkdown,
              relatedWords,
            },
          });
        } else {
          // 兜底：无预设词时（极端情况），从 LLM 标题提取并新建
          const extractedWord = extractWordFromMarkdown(cleanMarkdown, "");
          if (extractedWord) {
            await prisma.concept.upsert({
              where: { word: extractedWord },
              create: {
                word: extractedWord,
                fullMarkdown: cleanMarkdown,
                relatedWords,
              },
              update: {
                fullMarkdown: cleanMarkdown,
                relatedWords,
              },
            });
          }
        }
      } catch (dbError) {
        console.error("后台异步持久化入库失败:", dbError);
      }
    },
  });

  return result.toTextStreamResponse();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // useCompletion 的 complete() 发送 prompt 字段，前端直接 fetch 发送 word 字段
    const word = body.word ?? body.prompt ?? "";
    const checkOnly = body.checkOnly ?? false;
    const force = body.force ?? false;

    // ── 1. 缓存优先 ──────────────────────────────────
    // force 模式跳过缓存；不完整概念（fullMarkdown 为空或过短）视为未命中，自动重新生成
    if (word && !force) {
      const cachedConcept = await prisma.concept.findUnique({
        where: { word },
        include: { note: true },
      });
      if (cachedConcept && cachedConcept.fullMarkdown && cachedConcept.fullMarkdown.length > 50) {
        return Response.json({ mode: "cache", data: cachedConcept });
      }
    }

    // 仅缓存检查模式，不触发 LLM（force 模式下也跳过 checkOnly 短路）
    if (checkOnly && !force) {
      return Response.json({ mode: "miss" });
    }

    // ── 2. 去重引擎 ──────────────────────────────────
    const visitedConcepts = await prisma.concept.findMany({
      select: { word: true },
    });
    const visitedWords = visitedConcepts.map((c) => c.word);

    let targetWord = word;

    if (!targetWord) {
      const remainingSeeds = SEED_WORDS.filter(
        (w) => !visitedWords.includes(w)
      );
      if (remainingSeeds.length > 0) {
        targetWord = remainingSeeds[Math.floor(Math.random() * remainingSeeds.length)];
      } else {
        targetWord = "";
      }
    }

    const excludeWordsList = visitedWords.join(", ");

    // ── 3. 组合最终 Prompt ────────────────────────────
    const engineeringPatch = buildEngineeringPatch(excludeWordsList);
    const finalSystemPrompt = `${SYSTEM_PROMPT}\n\n${engineeringPatch}`;

    // ── 4. 双模型无感灾备转移（DeepSeek 优先：国际访问更快）──
    try {
      const deepseekClient = createOpenAICompatible({
        name: "deepseek",
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: process.env.DEEPSEEK_BASE_URL!,
      });
      const deepseekModel = process.env.DEEPSEEK_MODEL || "deepseek-chat";

      return await executeLLMStream(
        deepseekClient,
        deepseekModel,
        finalSystemPrompt,
        targetWord,
        targetWord
      );
    } catch (deepseekError) {
      console.warn(
        "DeepSeek 服务波动，正在无缝切流至备份模型 Zhipu...",
        deepseekError
      );

      const zhipuClient = createOpenAICompatible({
        name: "zhipu",
        apiKey: process.env.ZHIPU_API_KEY,
        baseURL: process.env.ZHIPU_BASE_URL!,
      });
      const zhipuModel = process.env.ZHIPU_MODEL || "glm-4-flash";

      return await executeLLMStream(
        zhipuClient,
        zhipuModel,
        finalSystemPrompt,
        targetWord,
        targetWord
      );
    }
  } catch (globalError) {
    console.error("全栈链路异常:", globalError);
    return Response.json({ error: "系统核心服务异常" }, { status: 500 });
  }
}
