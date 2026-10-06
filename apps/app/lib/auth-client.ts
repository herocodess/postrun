"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

/** Talks to /api/auth on this same site. */
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });
