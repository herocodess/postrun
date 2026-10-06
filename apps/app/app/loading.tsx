import { Loader } from "@postrun/brand/logo";

/** Shown while a page loads on the server: the mark playing, not a generic spinner. */
export default function Loading() {
  return (
    <div className="page-loader">
      <Loader size={36} label="Loading" />
    </div>
  );
}
