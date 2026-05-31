"use client";

import { useState, useEffect } from "react";

interface SeedItem {
  word: string;
  visited: boolean;
}

interface SeedBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (word: string) => void;
  isLoading?: boolean;
}

type FilterMode = "all" | "unvisited" | "visited";

const FILTER_LABELS: Record<FilterMode, string> = {
  all: "全部",
  unvisited: "待探索",
  visited: "已解构",
};

export default function SeedBrowser({
  isOpen,
  onClose,
  onSelect,
  isLoading: parentLoading,
}: SeedBrowserProps) {
  const [seeds, setSeeds] = useState<SeedItem[]>([]);
  const [stats, setStats] = useState({ total: 0, visited: 0, remaining: 0 });
  const [loading, setLoading] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch("/api/seeds")
      .then((r) => r.json())
      .then((data) => {
        setSeeds(data.seeds || []);
        setStats(data.stats || { total: 0, visited: 0, remaining: 0 });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen]);

  // 打开时锁定 body 滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredSeeds = seeds.filter((s) => {
    if (filterMode === "unvisited") return !s.visited;
    if (filterMode === "visited") return s.visited;
    return true;
  });

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] animate-fade-in"
        onClick={onClose}
      />

      {/* 面板 */}
      <div className="fixed inset-x-0 bottom-0 top-12 z-[210] bg-zinc-900 rounded-t-3xl md:inset-16 md:rounded-3xl flex flex-col animate-slide-up">
        {/* 头部 */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">
              🌱 种子词库
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {stats.visited}/{stats.total} 已解构 · {stats.remaining} 待探索
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 text-xl leading-none px-2"
          >
            ✕
          </button>
        </div>

        {/* 筛选标签 */}
        <div className="flex gap-2 px-4 py-2 border-b border-zinc-800/50 shrink-0">
          {(Object.keys(FILTER_LABELS) as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={`text-xs px-3 py-1 rounded-full transition ${
                filterMode === mode
                  ? "bg-amber-500 text-black font-medium"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {FILTER_LABELS[mode]}
            </button>
          ))}
        </div>

        {/* 种子列表 */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-center text-zinc-500 text-sm mt-12 animate-pulse">
              加载中…
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {filteredSeeds.map((seed) => (
                <button
                  key={seed.word}
                  onClick={() => {
                    onSelect(seed.word);
                    onClose();
                  }}
                  disabled={parentLoading}
                  className={`text-left px-3 py-2.5 rounded-xl border transition text-sm flex items-center gap-2 ${
                    seed.visited
                      ? "bg-zinc-800/50 border-zinc-700/50 text-zinc-400"
                      : "bg-zinc-800 border-zinc-700 text-zinc-200 hover:border-amber-500/30 active:bg-zinc-700"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <span className="text-xs shrink-0">
                    {seed.visited ? "✓" : "○"}
                  </span>
                  <span className="truncate">{seed.word}</span>
                </button>
              ))}
            </div>
          )}

          {!loading && filteredSeeds.length === 0 && (
            <p className="text-center text-zinc-500 text-sm mt-12">
              没有符合条件的种子词
            </p>
          )}
        </div>
      </div>
    </>
  );
}
