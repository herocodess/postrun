"use client";

/** One project: its numbers, its most edited files, and its sessions (the session list, filtered to this folder). */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ProjectFilesResponse, ProjectsResponse, ProjectSummary } from "@postrun/core/server/api";
import { SessionList } from "@/components/SessionList";
import { api, apiFetch } from "@/lib/api";
import { useLiveVersion } from "@/lib/live";
import { CountUp } from "@/lib/motion";

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

export function Project() {
  const root = useSearchParams().get("root") ?? "";
  const [project, setProject] = useState<ProjectSummary | null | undefined>(undefined);
  const [files, setFiles] = useState<ProjectFilesResponse["files"]>([]);
  const live = useLiveVersion();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiFetch(api.projects()).then(async (r) => (r.ok ? ((await r.json()) as ProjectsResponse).projects : [])),
      apiFetch(api.projectFiles(root)).then(async (r) => (r.ok ? ((await r.json()) as ProjectFilesResponse).files : [])),
    ])
      .then(([ps, fs]) => {
        if (cancelled) return;
        setProject(ps.find((p) => p.root === root) ?? null);
        setFiles(fs);
      })
      .catch(() => !cancelled && setProject(null));
    return () => {
      cancelled = true;
    };
  }, [root, live]);

  const max = Math.max(1, ...files.map((f) => f.edits + f.reads));
  const rel = (p: string) => (p.startsWith(root + "/") ? p.slice(root.length + 1) : p);
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/projects">Projects</Link>
        <span aria-hidden="true">/</span>
        <span>{basename(root)}</span>
      </nav>
      {project === null ? (
        <p className="card-empty">No sessions were recorded in {root || "this folder"}.</p>
      ) : (
        <div className="project-top enter">
          <div className="project-figs">
            <h1>{basename(root)}</h1>
            <p className="page-sub mono">{root}</p>
            {project && (
              <div className="project-stats big">
                <span>
                  <CountUp value={project.sessions} /> sessions
                </span>
                <span>
                  <CountUp value={project.steps} format={(x) => x.toLocaleString()} /> steps
                </span>
                <span className={project.failed ? "fail" : ""}>
                  <CountUp value={project.failed} /> failed ({project.steps ? ((project.failed / project.steps) * 100).toFixed(1) : "0.0"}%)
                </span>
                <span>
                  <CountUp value={project.unreviewed} /> not reviewed
                </span>
              </div>
            )}
          </div>
          <section className="card" aria-labelledby="pf-h">
            <div className="card-h">
              <h2 id="pf-h">Most changed files</h2>
            </div>
            {files.length === 0 ? (
              <p className="card-empty">No files edited or read yet.</p>
            ) : (
              <ul className="file-bars">
                {files.slice(0, 8).map((f, i) => (
                  <li key={f.path} title={f.path} style={{ ["--i" as string]: i }}>
                    <span className="file-row">
                      <span className="file-path">{rel(f.path)}</span>
                      <span className="file-n">
                        {f.edits} edit{f.edits === 1 ? "" : "s"}, {f.reads} read{f.reads === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="file-track two">
                      <span style={{ width: `${(f.edits / max) * 100}%` }}></span>
                      <span className="reads" style={{ width: `${(f.reads / max) * 100}%` }}></span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {root ? <SessionList workspace={root} /> : null}
    </>
  );
}
