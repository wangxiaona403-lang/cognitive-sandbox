"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useCompletion } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import debounce from "lodash/debounce";

interface Concept {
  id: string;
  word: string;
  fullMarkdown: string;
  relatedWords: string;
  note?: { content: string } | null;
}

export default function MobileMindGym() {
  const [currentConcept, setCurrentConcept] = useState<Concept | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const debouncedSaveRef = useRef<ReturnType<typeof debounce> | null>(null);

  const { completion, complete, setCompletion, isLoading } = useCompletion({
    api: "/api/think",
  });

  // 1.5 秒防抖静默保存
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
          // 静默失败，不打断用户
        }
        setIsSaving(false);
      },
      1500
    );

    return () => {
      debouncedSaveRef.current?.cancel();
    };
  }, []);

  // 核心请求：秒开缓存或调取大模型
  const handleFetchConcept = useCallback(
    async (targetWord?: string) => {
      setIsDrawerOpen(false);
      setNoteContent("");

      const res = await fetch("/api/think", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: targetWord ?? "" }),
      });

      const result = await res.json();

      if (result.mode === "cache") {
        setCurrentConcept(result.data);
        setCompletion(result.data.fullMarkdown);
        if (result.data.note) setNoteContent(result.data.note.content);
      } else {
        setCurrentConcept(null);
        complete(targetWord ?? "");
      }
    },
    [complete, setCompletion]
  );

  // 冷启动
  useEffect(() => {
    handleFetchConcept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 笔记变更 → 防抖保存
  const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNoteContent(val);
    if (currentConcept?.id) {
      debouncedSaveRef.current?.(currentConcept.id, val);
    }
  };

  // 流式结束后尝试从 completion 解析 concept（若无缓存返回）
  useEffect(() => {
    if (!isLoading && completion && !currentConcept) {
      const titleMatch = completion.match(/^#\s+(.+)$/m);
      if (titleMatch) {
        setCurrentConcept({
          id: "",
          word: titleMatch[1].trim(),
          fullMarkdown: completion,
          relatedWords: "",
        });
      }
    }
  }, [isLoading, completion, currentConcept]);

  // 解析推荐关联词
  const getRelatedWords = (): string[] => {
    if (currentConcept?.relatedWords) {
      return currentConcept.relatedWords
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean);
    }
    // 也从流文本动态提取
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

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-zinc-950 text-zinc-100 font-sans select-none">
      {/* 顶部极简导航栏 */}
      <header className="h-14 px-4 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 backdrop-blur shrink-0">
        <span className="text-sm font-semibold tracking-wider text-amber-400">
          🧠 思维沙盘
        </span>
        <div className="flex items-center gap-3">
          {isSaving && (
            <span className="text-xs text-zinc-500 animate-pulse">
              已静默保存
            </span>
          )}
          <button
            onClick={() => handleFetchConcept()}
            disabled={isLoading}
            className="text-xs px-3 py-1.5 rounded-full bg-amber-500 text-black font-medium active:scale-95 transition disabled:opacity-50"
          >
            {isLoading ? "碰撞中..." : "刷新新词"}
          </button>
        </div>
      </header>

      {/* 主体滚动阅读区 */}
      <main className="flex-1 overflow-y-auto px-4 py-6 pb-24 space-y-4 scrolling-touch">
        {!completion && !isLoading && (
          <p className="text-zinc-500 text-sm text-center mt-20">
            点击「刷新新词」开始思维探索
          </p>
        )}
        {isLoading && !completion && (
          <p className="text-zinc-500 text-sm text-center mt-20 animate-pulse">
            正在碰撞思维...
          </p>
        )}
        {completion && (
          <article className="prose prose-invert prose-amber max-w-none">
            <ReactMarkdown>{completion}</ReactMarkdown>
          </article>
        )}
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
              disabled={!currentConcept?.id && !completion}
              placeholder={
                currentConcept?.id || completion
                  ? "在这里记录你被触动的灵感、行业对照或破局思考..."
                  : "请等待大模型解构完成再记录笔记..."
              }
              className="flex-1 bg-zinc-950 text-zinc-200 text-sm p-3 rounded-lg border border-zinc-800 focus:outline-none focus:border-amber-500/50 resize-none placeholder-zinc-600 min-h-0"
            />
            {/* 延伸思考药丸卡片区 */}
            {relatedWords.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap py-1 scrollbar-none">
                <span className="text-xs text-zinc-500 shrink-0">
                  延伸触角:
                </span>
                {relatedWords.map((word, index) => (
                  <button
                    key={index}
                    onClick={() => handleFetchConcept(word)}
                    className="text-xs px-3 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 active:bg-amber-500 active:text-black transition shrink-0"
                  >
                    {word}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
