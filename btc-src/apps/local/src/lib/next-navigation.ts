import { useMemo } from "react";
import { navigate, replaceUrl, splitUrl, useUrl } from "./router";
export function usePathname() { return splitUrl(useUrl()).path; }
export function useSearchParams() { const u = useUrl(); return useMemo(() => new URLSearchParams(splitUrl(u).search), [u]); }
export function useRouter() { return { push: (u: string) => navigate(u), replace: (u: string) => replaceUrl(u), back: () => history.back(), refresh: () => undefined }; }
