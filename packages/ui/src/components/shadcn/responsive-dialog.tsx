import { createContext, useContext } from 'react';

import { useIsMobile } from '../../hooks/use-mobile';
import { cn } from '../../lib/utils';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './drawer';

type ResponsiveDialogContextValue = {
  isMobile: boolean;
  dismissible: boolean;
};

const ResponsiveDialogContext = createContext<ResponsiveDialogContextValue>({
  isMobile: false,
  dismissible: true,
});

const useResponsiveDialog = () => useContext(ResponsiveDialogContext);

/**
 * Renders a centered modal (Dialog) on desktop and a bottom sheet (Drawer) on
 * mobile, exposing the same component API as the shadcn Dialog so consumers can
 * swap `Dialog*` for `ResponsiveDialog*` without changing markup or styling.
 *
 * Pass `dismissible={false}` to disable drag/overlay/esc dismissal on both
 * variants (used for destructive confirmations).
 */
function ResponsiveDialog({
  dismissible = true,
  ...props
}: React.ComponentProps<typeof Drawer> & { dismissible?: boolean }) {
  const isMobile = useIsMobile();

  return (
    <ResponsiveDialogContext.Provider value={{ isMobile, dismissible }}>
      {isMobile ? (
        <Drawer
          dismissible={dismissible}
          {...props}
        />
      ) : (
        <Dialog {...props} />
      )}
    </ResponsiveDialogContext.Provider>
  );
}

function ResponsiveDialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogTrigger>) {
  const { isMobile } = useResponsiveDialog();
  const Comp = isMobile ? DrawerTrigger : DialogTrigger;
  return <Comp {...props} />;
}

function ResponsiveDialogClose({
  ...props
}: React.ComponentProps<typeof DialogClose>) {
  const { isMobile } = useResponsiveDialog();
  const Comp = isMobile ? DrawerClose : DialogClose;
  return <Comp {...props} />;
}

function ResponsiveDialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  const { isMobile, dismissible } = useResponsiveDialog();

  if (isMobile) {
    return (
      <DrawerContent
        className={className}
        {...props}
      >
        {/*
         * The whole body is marked data-vaul-no-drag so interactive controls
         * (sliders, buttons) receive their own pointer events instead of vaul
         * hijacking them for drag-to-dismiss; the drag handle (rendered by
         * DrawerContent above this node) stays draggable. px/pb give the body
         * the breathing room the desktop Dialog got from its p-6.
         */}
        <div
          className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pt-2 pb-6"
          data-vaul-no-drag
        >
          {children}
        </div>
      </DrawerContent>
    );
  }

  return (
    <DialogContent
      className={className}
      showCloseButton={dismissible && showCloseButton}
      {...(dismissible
        ? {}
        : {
            onEscapeKeyDown: (event) => event.preventDefault(),
            onInteractOutside: (event) => event.preventDefault(),
          })}
      {...props}
    >
      {children}
    </DialogContent>
  );
}

function ResponsiveDialogHeader({
  className,
  ...props
}: React.ComponentProps<typeof DialogHeader>) {
  const { isMobile } = useResponsiveDialog();
  // The body wrapper already supplies horizontal padding on mobile, so strip
  // the drawer header's own px/pt to keep the inset uniform.
  if (isMobile) {
    return (
      <DrawerHeader
        className={cn('px-0 pt-0', className)}
        {...props}
      />
    );
  }
  return (
    <DialogHeader
      className={className}
      {...props}
    />
  );
}

function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  const { isMobile } = useResponsiveDialog();
  if (isMobile) {
    return (
      <DrawerFooter
        className={cn('px-0 pb-0', className)}
        {...props}
      />
    );
  }
  return (
    <DialogFooter
      className={className}
      {...props}
    />
  );
}

function ResponsiveDialogTitle({
  ...props
}: React.ComponentProps<typeof DialogTitle>) {
  const { isMobile } = useResponsiveDialog();
  const Comp = isMobile ? DrawerTitle : DialogTitle;
  return <Comp {...props} />;
}

function ResponsiveDialogDescription({
  ...props
}: React.ComponentProps<typeof DialogDescription>) {
  const { isMobile } = useResponsiveDialog();
  const Comp = isMobile ? DrawerDescription : DialogDescription;
  return <Comp {...props} />;
}

export {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
};
