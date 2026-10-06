import { redirect } from "next/navigation";
import { viewer } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  redirect((await viewer()) ? "/shares" : "/login");
}
