"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useCompletion } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import debounce from "lodash/debounce";
import SearchDropdown from "@/components/search-dropdown";
import SeedBrowser from "@/components/seed-browser";

interface Concept {
  id: string;
  word: string;
  fullMarkdown: string;
  relatedWords: string;
  note?: { content: string } | null;
}

// 从 markdown 中提取标题并分离正文
function splitTitleFromMarkdown(md: string): {
  title: string;
  body: string;
} {
  const match = md.match(/^#\s+(.+)$/m);
  if (!match) return { title: "", body: md };
  const title = match[1].trim();
  const body = md.replace(/^#\s+.+\n\s*\n?/m, "").trim();
  return { title, body };
}

export default function MobileMindGym() {
  const [currentConcept, setCurrentConcept] = useState<Concept | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSeedPanel, setShowSeedPanel] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const pendingWordRef = useRef<string>("");
  const debouncedSaveRef = useRef<ReturnType<typeof debounce> | null>(null);

  const { completion, complete, setCompletion, isLoading } = useCompletion({
    api: "/api/think",
    streamProtocol: "text",
  });

  // 1.5 秒防抖静默保存笔记
  useEffect(() => {
    debouncedSaveRef.current = debounce(
      async (conceptId: string, content: string) => {
        setIsSaving(true);
        try {
          await fetch("/api/note", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conceptId, content }),
          });
        } catch {
          // 静默失败
        }
        setIsSaving(false);
      },
      1500
    );
    return () => {
      debouncedSaveRef.current?.cancel();
    };
  }, []);

  // 核心请求流：先查缓存（JSON），命中则秒开；未命中则走流式生成
  const handleFetchConcept = useCallback(
    async (targetWord?: string) => {
      setIsDrawerOpen(false);
      setNoteContent("");

      // 1. 快速缓存检查
      try {
        const checkRes = await fetch("/api/think", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word: targetWord ?? "", checkOnly: true }),
        });

        if (checkRes.ok) {
          const result = await checkRes.json();
          if (result.mode === "cache") {
            setCurrentConcept(result.data);
            setCompletion(result.data.fullMarkdown);
            if (result.data.note) setNoteContent(result.data.note.content);
            return;
          }
        }
      } catch {
        // 缓存检查失败，继续走流式
      }

      // 2. 缓存未命中 → 流式生成
      setCurrentConcept(null);
      pendingWordRef.current = targetWord ?? "";
      complete(targetWord ?? "");
    },
    [complete, setCompletion]
  );

  // 强制重新生成（跳过缓存，手动读取流式响应）
  const handleRegenerate = useCallback(async () => {
    const word = currentConcept?.word;
    if (!word || isLoading || isRegenerating) return;

    setIsDrawerOpen(false);
    setNoteContent("");
    setCurrentConcept(null);
    setCompletion("");
    setIsRegenerating(true);
    pendingWordRef.current = word;

    try {
      const res = await fetch("/api/think", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, force: true }),
      });

      if (!res.ok || !res.body) {
        setIsRegenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setCompletion(accumulated);
      }
      // 刷新解码器缓冲区
      accumulated += decoder.decode();
      if (accumulated) setCompletion(accumulated);
    } catch (err) {
      console.error("重新生成失败:", err);
    } finally {
      setIsRegenerating(false);
    }
  }, [currentConcept, isLoading, isRegenerating, setCompletion]);

  // 冷启动
  useEffect(() => {
    handleFetchConcept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 流式结束后从 API 获取真实概念 ID（以用户输入词为主键查询）
  useEffect(() => {
    if (!isLoading && !isRegenerating && completion && !currentConcept) {
      const lookupWord = pendingWordRef.current;
      if (lookupWord) {
        const fetchConcept = async (attempt: number) => {
          try {
            const res = await fetch(
              `/api/concepts?word=${encodeURIComponent(lookupWord)}`
            );
            if (res.ok) {
              const data = await res.json();
              if (data.result) {
                setCurrentConcept(data.result);
                if (data.result.note) {
                  setNoteContent(data.result.note.content);
                }
                return;
              }
            }
            // 概念尚未存入（onFinish 竞态），800ms 后重试一次
            if (attempt < 1) {
              setTimeout(() => fetchConcept(attempt + 1), 800);
            } else {
              // 兜底：使用临时 ID
              setCurrentConcept({
                id: `temp:${lookupWord}`,
                word: lookupWord,
                fullMarkdown: completion,
                relatedWords: "",
              });
            }
          } catch {
            if (attempt < 1) {
              setTimeout(() => fetchConcept(attempt + 1), 800);
            }
          }
        };
        fetchConcept(0);
      }
    }
  }, [isLoading, isRegenerating, completion, currentConcept]);

  // 笔记变更 → 防抖保存
  const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNoteContent(val);
    if (currentConcept?.id && !currentConcept.id.startsWith("temp:")) {
      debouncedSaveRef.current?.(currentConcept.id, val);
    }
  };

  // 解析推荐关联词
  const getRelatedWords = (): string[] => {
    if (currentConcept?.relatedWords) {
      return currentConcept.relatedWords
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean);
    }
    const match = completion.match(
      /\[RECOMMENDED_START\]([\s\S]*?)\[RECOMMENDED_END\]/
    );
    if (match) {
      return match[1]
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean);
    }
    return [];
  };

  const relatedWords = getRelatedWords();

  // 渲染关联词药丸条（抽离为函数，两处复用）
  const renderPillStrip = (words: string[], parentWord?: string) => {
    if (words.length === 0) return null;
    const label = parentWord ? `「${parentWord}」的延伸触角:` : "延伸触角:";
    return (
      <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap py-2 scrollbar-none">
        <span className="text-xs text-zinc-500 shrink-0">{label}</span>
        {words.map((word, index) => (
          <button
            key={`${word}-${index}`}
            onClick={(e) => {
              e.stopPropagation();
              handleFetchConcept(word);
            }}
            disabled={isLoading}
            className="text-xs px-3 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 active:bg-amber-500 active:text-black hover:border-amber-500/40 transition shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {word}
          </button>
        ))}
      </div>
    );
  };

  // 概念标题：优先用 currentConcept.word，其次从 markdown 提取
  const conceptTitle =
    currentConcept?.word || splitTitleFromMarkdown(completion).title;
  // 正文 markdown（去除 H1 标题后）
  const { body } = splitTitleFromMarkdown(
    currentConcept?.fullMarkdown || completion
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-zinc-950 text-zinc-100 font-sans select-none">
      {/* 顶部导航栏 */}
      <header className="h-14 px-3 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 backdrop-blur shrink-0 gap-2">
        <span className="text-sm font-semibold tracking-wider text-amber-400 shrink-0 hidden sm:inline">
          🧠 思维沙盘
        </span>

        {/* 搜索框 */}
        <SearchDropdown onSelect={(word) => handleFetchConcept(word)} />

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowSeedPanel(true)}
            className="text-xs px-2.5 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 active:bg-zinc-700 transition"
          >
            🌱 词库
          </button>
          {isSaving && (
            <span className="text-xs text-zinc-500 animate-pulse hidden sm:inline">
              已静默保存
            </span>
          )}
          <button
            onClick={() => handleFetchConcept()}
            disabled={isLoading}
            className="text-xs px-3 py-1.5 rounded-full bg-amber-500 text-black font-medium active:scale-95 transition disabled:opacity-50 whitespace-nowrap"
          >
            {isLoading ? "碰撞中..." : "刷新"}
          </button>
        </div>
      </header>

      {/* 主体滚动阅读区 */}
      <main className="flex-1 overflow-y-auto px-4 py-6 pb-4 space-y-4 scrolling-touch">
        {!completion && !isLoading && (
          <p className="text-zinc-500 text-sm text-center mt-20">
            点击「刷新」开始思维探索
          </p>
        )}
        {isLoading && !completion && (
          <p className="text-zinc-500 text-sm text-center mt-20 animate-pulse">
            正在碰撞思维...
          </p>
        )}

        {completion && (
          <>
            {/* 突出标题 + 重新生成按钮 */}
            {conceptTitle && (
              <div className="mb-6">
                <div className="flex items-start justify-between gap-3">
                  <h1 className="text-2xl font-bold text-amber-300 tracking-wide leading-tight">
                    {conceptTitle}
                  </h1>
                  {(currentConcept || completion) && (
                    <button
                      onClick={handleRegenerate}
                      disabled={isLoading || isRegenerating}
                      className="text-xs px-2.5 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-amber-300 hover:border-amber-500/40 active:scale-95 transition disabled:opacity-40 shrink-0 mt-0.5"
                    >
                      {isRegenerating ? "生成中..." : "🔄 重新生成"}
                    </button>
                  )}
                </div>
                {/* 不完整概念警告 */}
                {currentConcept &&
                  (!currentConcept.fullMarkdown ||
                    currentConcept.fullMarkdown.length < 100) && (
                    <p className="mt-2 text-xs text-amber-500/70">
                      ⚠️ 此内容可能未生成完整，建议点击「🔄 重新生成」
                    </p>
                  )}
                <div className="mt-2 w-12 h-0.5 bg-amber-500/50 rounded-full" />
              </div>
            )}

            {/* Markdown 正文（已去除标题） */}
            <article className="prose prose-invert prose-amber max-w-none">
              <ReactMarkdown>{body || completion}</ReactMarkdown>
            </article>

            {/* 始终可见的关联词药丸 */}
            {renderPillStrip(relatedWords, conceptTitle)}
          </>
        )}

        {/* 底部留白（给抽屉把手） */}
        <div className="h-16" />
      </main>

      {/* 底部可上滑思维沙盘抽屉 */}
      <div
        className={`fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 transition-all duration-300 z-50 flex flex-col ${
          isDrawerOpen ? "h-[45vh]" : "h-[60px]"
        }`}
      >
        {/* 抽屉把手 */}
        <div
          onClick={() => setIsDrawerOpen(!isDrawerOpen)}
          className="h-[60px] px-4 flex items-center justify-between cursor-pointer border-b border-zinc-800/50 active:bg-zinc-800/30 shrink-0"
        >
          <div className="flex items-center gap-2">
            <span>📝</span>
            <span className="text-sm font-medium text-zinc-300">
              {isDrawerOpen
                ? "正在整理思想沙盘..."
                : "点击或上划展开思维沙盘"}
            </span>
          </div>
          <span className="text-xs text-zinc-500">
            {isDrawerOpen ? "👇 收起" : "👆 展开"}
          </span>
        </div>

        {/* 抽屉内部 */}
        {isDrawerOpen && (
          <div className="flex-1 p-4 flex flex-col gap-3 min-h-0">
            <textarea
              value={noteContent}
              onChange={handleNoteChange}
              disabled={
                !currentConcept?.id || currentConcept.id.startsWith("temp:")
              }
              placeholder={
                currentConcept?.id && !currentConcept.id.startsWith("temp:")
                  ? "在这里记录你被触动的灵感、行业对照或破局思考..."
                  : "请等待大模型解构完成再记录笔记..."
              }
              className="flex-1 bg-zinc-950 text-zinc-200 text-sm p-3 rounded-lg border border-zinc-800 focus:outline-none focus:border-amber-500/50 resize-none placeholder-zinc-600 min-h-0"
            />
            {/* 抽屉内的药丸（记笔记时也可点击） */}
            {renderPillStrip(relatedWords, conceptTitle)}
          </div>
        )}
      </div>

      {/* 种子词浏览器 */}
      <SeedBrowser
        isOpen={showSeedPanel}
        onClose={() => setShowSeedPanel(false)}
        onSelect={(word) => handleFetchConcept(word)}
        isLoading={isLoading}
      />
    </div>
  );
}
