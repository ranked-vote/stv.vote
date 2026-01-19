import { json } from "@sveltejs/kit";
import { getIndex } from "$lib/server/reports";
import type { RequestHandler } from "./$types";

export const prerender = true;

export const GET: RequestHandler = async () => {
  const index = getIndex();
  return json(index);
};
