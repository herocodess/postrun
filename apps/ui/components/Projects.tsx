"use client";

/** Every project (working folder) with sessions in it, most recently active first. */

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProjectsResponse, ProjectSummary } from "@postrun/core/server/api";
import { api } from "@/lib/api";
import { useLiveVersion } from "@/lib/live";
import { stagger } from "@/lib/motion";
import { ago } from "@/lib/status";

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
const parent = (p: string) => p.replace(/\/+$/, "").split("/").slice(0, -1).join("/").replace(/^\/(Users|home)\/[^/]+/, "~");

export function projectHref(root: string): string {
  return `/project?root=${encodeURIComponent(root)}`;
}

export function Projects() {
  const [projects, setProjects] = useState<ProjectSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const live = useLiveVersion();
  useEffect(() => {
    let cancelled = false;
    fetch(api.projects())
      .then(async (r) => {
        if (!r.ok) throw new Error(`GET /api/projects -> ${r.status}`);
        return ((await r.json()) as ProjectsResponse).projects;
      })
      .then((p) => !cancelled && setProjects(p))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [live]);

  if (error && !projects) return <p className="error">Could not load projects: {error}</p>;
  return (
    <>
      <header className="page-head enter">
        <div>
          <h1>Projects</h1>
          <p className="page-sub">Each folder your agents worked in, with its sessions, failures and reviews.</p>
        </div>
      </header>
      {!projects ? (
        <div className="project-grid" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="project-card skeleton-row" style={{ animationDelay: `${i * 90}ms` }}>
              <span className="sk" style={{ width: "50%", height: 16 }}></span>
              <span className="sk" style={{ width: "70%" }}></span>
              <span className="sk" style={{ height: 40 }}></span>
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <p className="card-empty">No projects yet. They appear once an agent records a session in a folder.</p>
      ) : (
        <div className="project-grid">
          {projects.map((p, i) => {
            const rate = p.steps ? (p.failed / p.steps) * 100 : 0;
            return (
              <Link key={p.root} href={projectHref(p.root)} className="project-card enter" style={stagger(i)}>
                <span className="project-name">{basename(p.root)}</span>
                <span className="project-path">{parent(p.root) || "/"}</span>
                <span className="project-stats">
                  <span>
                    <b>{p.sessions}</b> session{p.sessions === 1 ? "" : "s"}
                  </span>
                  <span>
                    <b>{p.steps.toLocaleString()}</b> steps
                  </span>
                  <span className={rate >= 5 ? "fail" : ""}>
                    <b>{rate.toFixed(1)}%</b> failed
                  </span>
                </span>
                <span className="project-foot">
                  {p.unreviewed > 0 ? <span className="verdict-chip none">{p.unreviewed} not reviewed</span> : <span className="verdict-chip ok">All reviewed</span>}
                  {p.flags > 0 ? <span className="flag">{p.flags} flags</span> : null}
                  <span className="grow"></span>
                  <span className="muted">{ago(p.last_at)}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
