/**
 * /submit is now unified with the landing page. Keep the route as a
 * redirect for any stale links or bookmarks.
 */
import { redirect } from "next/navigation";

export default function SubmitRedirect() {
  redirect("/");
}
