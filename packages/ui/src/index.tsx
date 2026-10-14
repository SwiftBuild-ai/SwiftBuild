'use client';
export { TechnologyIcon } from './technology-icon';
import {
  useId,
  useRef,
  useLayoutEffect,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
  type ComponentPropsWithRef,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
export function Tabs({
  value,
  onChange,
  items,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  items: { id: string; label: string; content: ReactNode }[];
  label: string;
}) {
  const prefix = useId();
  return (
    <div className="sb-tabs">
      <div role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            key={item.id}
            id={`${prefix}-${item.id}-tab`}
            role="tab"
            aria-selected={value === item.id}
            aria-controls={`${prefix}-${item.id}-panel`}
            tabIndex={value === item.id ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === 'ArrowRight') next = (index + 1) % items.length;
              else if (event.key === 'ArrowLeft')
                next = (index + items.length - 1) % items.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = items.length - 1;
              else return;
              event.preventDefault();
              onChange(items[next]!.id);
              const buttons =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              buttons?.[next]?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          id={`${prefix}-${item.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${prefix}-${item.id}-tab`}
          hidden={value !== item.id}
          tabIndex={0}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`sb-status status-${status}`}>
      {status.replaceAll('-', ' ')}
    </span>
  );
}
export function Button({
  children,
  className = '',
  variant = 'secondary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  return (
    <button className={`sb-button ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: ComponentPropsWithRef<'button'> & { label: string }) {
  return (
    <Tooltip.Provider delayDuration={350}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button className="icon-button" aria-label={label} {...props}>
            {children}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="sb-tooltip" sideOffset={8}>
            {label}
            <Tooltip.Arrow />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  returnFocusRef,
  initialFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const opener = useRef<HTMLElement | null>(null);
  // Track the invoker while closed, before child autofocus runs during mount.
  // Ignore other dialogs so a dialog handoff retains the original invoker.
  useLayoutEffect(() => {
    if (open) return;
    const remember = () => {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        !active.closest('[role="dialog"]')
      )
        opener.current = active;
    };
    remember();
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className="modal-content"
          onOpenAutoFocus={(event) => {
            if (initialFocusRef?.current) {
              event.preventDefault();
              initialFocusRef.current.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // A destination dialog owns focus when dialogs hand off.
            if (document.querySelector('[role="dialog"][data-state="open"]'))
              return;
            const target = returnFocusRef?.current ?? opener.current;
            if (target?.isConnected && !target.closest('[inert]'))
              target.focus();
            else {
              const fallback =
                document.querySelector<HTMLElement>(
                  'main[tabindex="-1"]:not([inert] *)',
                ) ??
                document.querySelector<HTMLElement>(
                  'button:not(:disabled):not([inert] *)',
                );
              fallback?.focus();
            }
          }}
        >
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="Close dialog">
                Close
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ActionMenu({
  trigger,
  label,
  items,
}: {
  trigger: ReactNode;
  label: string;
  items: {
    label: string;
    icon?: ReactNode;
    shortcut?: string;
    onSelect: () => void;
    disabled?: boolean;
  }[];
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="action-menu"
          aria-label={label}
          align="end"
          sideOffset={8}
        >
          {items.map((item) => (
            <DropdownMenu.Item
              className="action-menu-item"
              key={item.label}
              onSelect={item.onSelect}
              disabled={item.disabled}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
