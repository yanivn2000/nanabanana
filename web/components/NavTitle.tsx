"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// Lets a page (e.g. a city page) show a contextual title next to the logo in the
// global TopNav — "יאלה · אמסטרדם 🇳🇱" — without threading props through the layout.
type NavTitleCtx = { title: ReactNode; setTitle: (t: ReactNode) => void };
const Ctx = createContext<NavTitleCtx>({ title: null, setTitle: () => {} });

export function NavTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<ReactNode>(null);
  return <Ctx.Provider value={{ title, setTitle }}>{children}</Ctx.Provider>;
}

export function useNavTitle() {
  return useContext(Ctx);
}
