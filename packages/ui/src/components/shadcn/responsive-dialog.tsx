import { createContext, useContext } from 'react';

import { useIsMobile } from '../../hooks/use-mobile';
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
        {children}
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
  ...props
}: React.ComponentProps<typeof DialogHeader>) {
  const { isMobile } = useResponsiveDialog();
  const Comp = isMobile ? DrawerHeader : DialogHeader;
  return <Comp {...props} />;
}

function ResponsiveDialogFooter({
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  const { isMobile } = useResponsiveDialog();
  const Comp = isMobile ? DrawerFooter : DialogFooter;
  return <Comp {...props} />;
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
