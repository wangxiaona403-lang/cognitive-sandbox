"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface SearchResult {
  id: string;
  word: string;
  snippet: string;
  createdAt: string;
}

interface SearchDropdownProps {
  onSelect: (word: string) => void;
}

export default function SearchDropdown({ onSelect }: SearchDropdownProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 防抖搜索
  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 1) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/concepts?q=${encodeURIComponent(q.trim())}`
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch {
      // 静默失败
    }
    setIsSearching(false);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(v), 300);
  };

  const handleGenerate = () => {
    const word = query.trim();
    if (!word) return;
    onSelect(word);
    setQuery("");
    setIsOpen(false);
    setResults([]);
  };

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && query.trim()) {
            handleGenerate();
          }
        }}
        placeholder="搜索或输入新词…"
        className="w-full bg-zinc-800 text-zinc-200 text-xs rounded-full px-3 py-1.5 border border-zinc-700 focus:border-amber-500/50 focus:outline-none placeholder-zinc-500 transition"
      />
      {isSearching && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs animate-pulse">
          …
        </span>
      )}

      {/* 下拉面板 */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-850 border border-zinc-700 rounded-xl shadow-2xl max-h-64 overflow-y-auto z-[100]">
          {results.length > 0 && (
            <>
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    onSelect(r.word);
                    setQuery("");
                    setIsOpen(false);
                    setResults([]);
                  }}
                  className="w-full text-left px-3 py-2.5 hover:bg-zinc-800 border-b border-zinc-800/50 last:border-0 transition"
                >
                  <div className="text-xs font-medium text-amber-300">
                    {r.word}
                  </div>
                  <div className="text-xs text-zinc-500 truncate mt-0.5">
                    {r.snippet}
                  </div>
                </button>
              ))}
            </>
          )}

          {/* 无结果 + 非空查询 → 生成新概念 */}
          {!isSearching &&
            query.trim().length >= 1 &&
            results.length === 0 && (
              <button
                onClick={handleGenerate}
                className="w-full text-left px-3 py-3 hover:bg-zinc-800 transition flex items-center gap-2"
              >
                <span className="text-sm">✨</span>
                <div>
                  <div className="text-xs font-medium text-amber-300">
                    生成「{query.trim()}」的概念解析
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    词库中暂无此词，点击调用大模型现场解构
                  </div>
                </div>
              </button>
            )}

          {/* 空查询提示 */}
          {query.trim().length < 1 && results.length === 0 && (
            <div className="px-4 py-3">
              <p className="text-xs text-zinc-500 text-center">
                输入关键词搜索已解构的概念
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
