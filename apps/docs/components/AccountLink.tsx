"use client";

import { useEffect, useState } from "react";
import { signedInHere } from "@postrun/brand/logo";

const APP = "https://app.postrun.app";

/** Sign in, or Dashboard when this browser is signed in at app.postrun.app. */
export function AccountLink() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(signedInHere()), []);
  return signedIn ? (
    <a href={`${APP}/shares`} className="btn btn-primary btn-sm">
      Dashboard
    </a>
  ) : (
    <a href={`${APP}/login`} className="btn btn-primary btn-sm">
      Sign in
    </a>
  );
}
