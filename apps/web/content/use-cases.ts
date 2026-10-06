/** The use-case pages, for the /use-cases/ index. Each slug has a page under app/use-cases/. */

export interface UseCase {
  slug: string;
  kicker: string;
  title: string;
  summary: string;
}

export const USE_CASES: UseCase[] = [
  {
    slug: "review-before-merge",
    kicker: "FOR REVIEWERS",
    title: "Review an agent's work before you merge",
    summary: "The diff shows where the branch ended up. The session shows how it got there: every command, failure and edit along the way.",
  },
  {
    slug: "client-reporting",
    kicker: "FOR AGENCIES AND FREELANCERS",
    title: "Show a client what the agent did",
    summary: "Send one redacted report of the session instead of a hand-written summary or raw logs full of your keys and paths.",
  },
  {
    slug: "agent-postmortems",
    kicker: "FOR WHEN IT GOES WRONG",
    title: "Post-mortem when an agent breaks something",
    summary: "Walk the session step by step to the first failure, see exactly what the agent ran and changed, and share the record with your team.",
  },
];
