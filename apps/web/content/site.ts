/** Contact details shown across the site. */
export const CONTACT_EMAIL = "hm@heromomoh.com";
/** The source, public under the MIT license. */
export const GITHUB_URL = "https://github.com/herocodess/postrun";
/**
 * The account app (sign in, share links). NEXT_PUBLIC_POSTRUN_APP_URL points the site at
 * a local copy while developing, e.g. http://localhost:3001.
 */
export const APP_URL = (process.env["NEXT_PUBLIC_POSTRUN_APP_URL"] ?? "https://app.postrun.app").replace(/\/+$/, "");
export const LOGIN_URL = `${APP_URL}/login`;
/** Getting started means installing Postrun, not making an account: recording never needs one. */
export const START_URL = "/#install";
