/**
 * Extended menu-items hooks that work with the full MenuItemFull shape
 * (including titleBn, parentId, menuType, visibility, isNoFollow, footerGroup).
 *
 * These are hand-written because the generated api-client only knows the
 * original minimal MenuItem shape.  Do NOT regenerate over this file.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import type { UseQueryOptions, UseMutationOptions } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ─── Constants ────────────────────────────────────────────────────────────────

export const MENU_LOCATIONS = ["header", "footer", "both", "hidden"] as const;
export const MENU_TYPES     = ["internal", "external", "custom", "category", "blog", "tool"] as const;
export const MENU_VISIBILITIES = ["public", "logged-in", "doctor", "assistant", "admin"] as const;
export const FOOTER_GROUPS  = ["quick-links", "services", "resources", "legal", "contact"] as const;

export type MenuLocation    = typeof MENU_LOCATIONS[number];
export type MenuType        = typeof MENU_TYPES[number];
export type MenuVisibility  = typeof MENU_VISIBILITIES[number];
export type FooterGroup     = typeof FOOTER_GROUPS[number];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MenuItemFull {
  id: number;
  label: string;
  titleBn?: string | null;
  url: string;
  location: MenuLocation;
  footerGroup?: string | null;
  menuType?: string;
  visibility?: string;
  parentId?: number | null;
  displayOrder?: number;
  openInNewTab?: boolean;
  isNoFollow?: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface MenuItemFullInput {
  label: string;
  titleBn?: string | null;
  url?: string;
  location?: MenuLocation;
  footerGroup?: string | null;
  menuType?: string;
  visibility?: string;
  parentId?: number | null;
  displayOrder?: number;
  openInNewTab?: boolean;
  isNoFollow?: boolean;
  isActive?: boolean;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const getMenuItemsFullQueryKey = (params?: { all?: string; location?: string }) =>
  ["/api/menu-items-full", params] as const;

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useListMenuItemsFull(
  params?: { all?: string; location?: string },
  options?: { query?: Partial<UseQueryOptions<MenuItemFull[], unknown, MenuItemFull[]>> },
) {
  const sp = new URLSearchParams();
  if (params?.all) sp.set("all", params.all);
  if (params?.location) sp.set("location", params.location);
  const url = `/api/menu-items${sp.toString() ? "?" + sp.toString() : ""}`;

  return useQuery<MenuItemFull[]>({
    queryKey: getMenuItemsFullQueryKey(params),
    queryFn: ({ signal }) => customFetch<MenuItemFull[]>(url, { signal }),
    ...options?.query,
  });
}

export function useCreateMenuItemFull(
  options?: { mutation?: UseMutationOptions<MenuItemFull, unknown, MenuItemFullInput> },
) {
  return useMutation<MenuItemFull, unknown, MenuItemFullInput>({
    mutationFn: (data) =>
      customFetch<MenuItemFull>("/api/menu-items", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    ...options?.mutation,
  });
}

export function useUpdateMenuItemFull(
  options?: { mutation?: UseMutationOptions<MenuItemFull, unknown, { id: number; data: Partial<MenuItemFullInput> }> },
) {
  return useMutation<MenuItemFull, unknown, { id: number; data: Partial<MenuItemFullInput> }>({
    mutationFn: ({ id, data }) =>
      customFetch<MenuItemFull>(`/api/menu-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    ...options?.mutation,
  });
}

export function useDeleteMenuItemFull(
  options?: { mutation?: UseMutationOptions<void, unknown, { id: number }> },
) {
  return useMutation<void, unknown, { id: number }>({
    mutationFn: ({ id }) =>
      customFetch<void>(`/api/menu-items/${id}`, { method: "DELETE" }),
    ...options?.mutation,
  });
}

export function useReorderMenuItems(
  options?: { mutation?: UseMutationOptions<{ ok: boolean }, unknown, { id: number; displayOrder: number }[]> },
) {
  return useMutation<{ ok: boolean }, unknown, { id: number; displayOrder: number }[]>({
    mutationFn: (items) =>
      customFetch<{ ok: boolean }>("/api/menu-items/reorder", {
        method: "POST",
        body: JSON.stringify(items),
      }),
    ...options?.mutation,
  });
}
