"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/** Folha que sobe do rodapé no celular e vira um painel central no computador. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content aria-describedby={undefined} className="sheet-in fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-xl bg-sheet md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[520px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl">
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line-strong md:hidden" aria-hidden />
          <div className="flex items-center justify-between px-5 pt-3 pb-2">
            <Dialog.Title className="text-[17px] font-semibold">{title}</Dialog.Title>
            <Dialog.Close aria-label="Fechar" className="-mr-2 grid size-11 place-items-center rounded-full text-muted"><X className="size-5" /></Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
          {footer && <div className="border-t border-line px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+14px)] md:pb-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
