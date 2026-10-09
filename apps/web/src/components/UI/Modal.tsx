import * as Dialog from "@radix-ui/react-dialog";
import type React from "react";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  destructive?: boolean;
  preventOutsideClose?: boolean;
  loading?: boolean;
  width?: string; // Defaults to 440px, pass "480px" for TypeToConfirm
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  destructive = false,
  preventOutsideClose = false,
  loading = false,
  width = "440px",
}: ModalProps) {
  const handleOpenChange = (nextOpen: boolean) => {
    if (loading) return; // Lock dismissal while loading
    onOpenChange(nextOpen);
  };

  // Extract the exact event type directly from Radix's Dialog.Content props else it will not get extracted
  const handlePointerDownOutside: React.ComponentProps<typeof Dialog.Content>['onPointerDownOutside'] = (event) => {
    if (destructive || preventOutsideClose || loading) {
      event?.preventDefault();
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={`fixed inset-0 z-40 transition-opacity duration-150 ease-out ${
            destructive ? "bg-[#0A0B0D]/85" : "bg-[#0A0B0D]/75"
          }`}
        />
        <Dialog.Content
          onPointerDownOutside={handlePointerDownOutside}
          className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 max-h-[calc(100vh-128px)] overflow-y-auto bg-[#1C1F26] border border-[#2A2E37] rounded-[14px] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.55),0_8px_20px_rgba(0,0,0,0.35)] outline-none`}
          style={{ width }}
        >
          {title && (
            <Dialog.Title className="text-[14px] font-semibold text-[#EDEEF0] leading-5 tracking-[-0.01em]">
              {title}
            </Dialog.Title>
          )}
          {description && (
            <Dialog.Description className="text-[13px] font-normal text-[#8B909C] leading mt-1">
              {description}
            </Dialog.Description>
          )}
          <div className={title || description ? "mt-5" : ""}>
            {children}
          </div>
          {footer && (
            <div className="mt-6 flex gap-2 justify-end">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}