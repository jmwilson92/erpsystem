import { redirect } from "next/navigation";

// Index route for a folder that only has detail pages — send the user
// back to the parent module.
export default function IndexRedirect() {
  redirect("/purchasing");
}
