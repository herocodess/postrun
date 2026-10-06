"use client";

/**
 * Whether the sidebar is expanded or collapsed to icons, remembered in this
 * browser. Like the theme, it is set on <html> before first paint (a small
 * script in the layout), so the page never jumps between widths on load.
 * The sidebar button, the [ key and Settings all change the same value.
 */

import { useEffect, useState } from "react";

export type SidebarMode = "expanded" | "collapsed";

const KEY = "postrun.sidebar";
const EVENT = "postrun:sidebar";

export function readSidebar(): SidebarMode {
  try {
    return window.localStorage.getItem(KEY) === "collapsed" ? "collapsed" : "expanded";
  } catch {
    return "expanded";
  }
}

export function applySidebar(mode: SidebarMode): void {
  const root = document.documentElement;
  if (mode === "collapsed") root.dataset["sidebar"] = "collapsed";
  else delete root.dataset["sidebar"];
  try {
    if (mode === "collapsed") window.localStorage.setItem(KEY, "collapsed");
    else window.localStorage.removeItem(KEY);
  } catch {
    // not remembered
  }
  window.dispatchEvent(new CustomEvent<SidebarMode>(EVENT, { detail: mode }));
}

/** The current mode, kept in step wherever it is changed. */
export function useSidebar(): [SidebarMode, (m: SidebarMode) => void] {
  const [mode, setMode] = useState<SidebarMode>("expanded");
  useEffect(() => {
    setMode(readSidebar());
    const on = (e: Event) => setMode((e as CustomEvent<SidebarMode>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [mode, applySidebar];
}
