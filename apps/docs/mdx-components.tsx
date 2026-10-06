import type { MDXComponents } from "mdx/types";
import { Callout } from "@/components/Callout";
import { Pre } from "@/components/Code";

/** Global MDX components (required by @next/mdx in the App Router). */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    pre: Pre,
    table: (props) => (
      <div className="table-wrap">
        <table {...props} />
      </div>
    ),
    Callout,
    ...components,
  };
}
