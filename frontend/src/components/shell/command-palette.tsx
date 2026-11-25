"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  GitBranch,
  History,
  LayoutDashboard,
  LucideIcon,
  Search,
  Settings,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import type { NavItem } from "./sidebar";
import { sampleQueries } from "@/data/example-queries";
import { useDialog } from "@/lib/use-dialog";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectView: (view: NavItem) => void;
  onExecuteSearch: (query: string) => void;
}

const QUICK_NAV: Array<{ label: string; view: NavItem; icon: LucideIcon }> = [
  { label: "Overview Dashboard", view: "overview", icon: LayoutDashboard },
  { label: "Intelligent Search Workspace", view: "search", icon: Search },
  { label: "Query Compiler Analyzer", view: "analyzer", icon: Terminal },
  { label: "Compiler Pipeline Visualization", view: "pipeline", icon: GitBranch },
  { label: "Document Library & Codebase", view: "library", icon: BookOpen },
  { label: "Search History Log", view: "history", icon: History },
  { label: "Analytics & Benchmarks", view: "analytics", icon: Activity },
  { label: "System Preferences & Settings", view: "settings", icon: Settings },
];

type PaletteAction =
  | { id: string; kind: "direct"; query: string }
  | { id: string; kind: "preset"; query: string }
  | { id: string; kind: "nav"; view: NavItem; label: string; icon: LucideIcon };

export function CommandPalette({
  isOpen,
  onClose,
  onSelectView,
  onExecuteSearch,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useDialog<HTMLDivElement>(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [isOpen]);

  const trimmed = query.trim();
  const qLower = trimmed.toLowerCase();

  const filteredQueries = useMemo(
    () => sampleQueries.filter((q) => q.toLowerCase().includes(qLower)).slice(0, 3),
    [qLower]
  );

  const filteredNav = useMemo(
    () => QUICK_NAV.filter((item) => item.label.toLowerCase().includes(qLower) || item.view.includes(qLower)),
    [qLower]
  );

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [];
    if (trimmed.length > 0) {
      list.push({ id: "direct-search", kind: "direct", query: trimmed });
    }
    for (const sq of filteredQueries) {
      list.push({ id: `preset-${sq}`, kind: "preset", query: sq });
    }
    for (const nav of filteredNav) {
      list.push({ id: `nav-${nav.view}`, kind: "nav", view: nav.view, label: nav.label, icon: nav.icon });
    }
    return list;
  }, [trimmed, filteredQueries, filteredNav]);

  useEffect(() => {
    setActiveIndex(0);
  }, [qLower]);

  if (!isOpen) return null;

  const runAction = (action: PaletteAction) => {
    if (action.kind === "nav") {
      onSelectView(action.view);
    } else {
      onExecuteSearch(action.query);
    }
    onClose();
  };

  let runningIndex = 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quick search and navigation"
        className="modal-dialog"
        style={{ maxWidth: "min(580px, calc(100vw - 20px))", padding: 0, overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <Search size={18} aria-hidden="true" style={{ color: "var(--accent-text)" }} />
          <input
            autoFocus
            type="text"
            aria-label="Search query or page name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && actions.length > 0) {
                e.preventDefault();
                setActiveIndex((prev) => (prev + 1) % actions.length);
              } else if (e.key === "ArrowUp" && actions.length > 0) {
                e.preventDefault();
                setActiveIndex((prev) => (prev - 1 + actions.length) % actions.length);
              } else if (e.key === "Enter" && actions.length > 0) {
                e.preventDefault();
                const target = actions[activeIndex] ?? actions[0];
                runAction(target);
              }
            }}
            placeholder="Type a natural-language search query or jump to a page..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-main)",
              fontSize: 14,
              fontFamily: "inherit",
            }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="btn-icon"
              aria-label="Clear input"
              style={{ width: 24, height: 24 }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : (
            <span className="kbd-shortcut">ESC</span>
          )}
        </div>

        {/* Action content */}
        <div style={{ maxHeight: 380, overflowY: "auto", padding: "12px 10px" }}>
          {trimmed.length > 0 && (() => {
            const idx = runningIndex++;
            const isSelected = idx === activeIndex;
            return (
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-faint)",
                    textTransform: "uppercase",
                    padding: "4px 10px",
                    letterSpacing: "0.5px",
                  }}
                >
                  Execute Direct Search
                </div>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    onExecuteSearch(trimmed);
                    onClose();
                  }}
                  className={`nav-link ${isSelected ? "active" : ""}`}
                  style={{
                    padding: "10px 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Sparkles size={16} style={{ color: "var(--accent-text)" }} />
                    <span style={{ color: "var(--text-main)", fontWeight: 600 }}>
                      Search &quot;{trimmed}&quot;
                    </span>
                  </div>
                  <span className="kbd-shortcut">↵ Enter</span>
                </button>
              </div>
            );
          })()}

          {/* Quick Query Presets */}
          {filteredQueries.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  padding: "4px 10px",
                  letterSpacing: "0.5px",
                }}
              >
                Suggested Query Prompts
              </div>
              {filteredQueries.map((sq) => {
                const idx = runningIndex++;
                const isSelected = idx === activeIndex;
                return (
                  <button
                    type="button"
                    key={sq}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      onExecuteSearch(sq);
                      onClose();
                    }}
                    className={`nav-link ${isSelected ? "active" : ""}`}
                    style={{ padding: "8px 12px", fontSize: 12.5 }}
                  >
                    <Terminal size={14} style={{ color: "var(--info)" }} />
                    <span style={{ flex: 1, textAlign: "left" }}>{sq}</span>
                    <ArrowRight size={13} style={{ color: "var(--text-faint)" }} />
                  </button>
                );
              })}
            </div>
          )}

          {/* Page Jumps */}
          {filteredNav.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  padding: "4px 10px",
                  letterSpacing: "0.5px",
                }}
              >
                Application Views
              </div>
              {filteredNav.map((item) => {
                const idx = runningIndex++;
                const isSelected = idx === activeIndex;
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.view}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      onSelectView(item.view);
                      onClose();
                    }}
                    className={`nav-link ${isSelected ? "active" : ""}`}
                    style={{ padding: "8px 12px" }}
                  >
                    <Icon size={15} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer shortcuts */}
        <div
          style={{
            padding: "8px 16px",
            background: "var(--bg-card-subtle)",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          <span>Use ↑↓ to navigate, natural language or view names</span>
          <div style={{ display: "flex", gap: 8 }}>
            <span><span className="kbd-shortcut">↵</span> to select</span>
            <span><span className="kbd-shortcut">esc</span> to close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
