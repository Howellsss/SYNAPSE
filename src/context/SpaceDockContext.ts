import { createContext, useContext } from 'react';

/**
 * A workspace you're in can shrink to a panel on the right while you use the rest of SYNAPSE:
 * you stay in the space (people see you, conversations keep going) and can open it again.
 */
export interface SpaceDock {
  /** The space is shown as the side panel, not full screen. */
  docked: boolean;
  /** Go to the main pages, keeping the space open on the right. */
  dock: () => void;
  /** Back to the space, full screen. */
  expand: () => void;
  /** Leave the space altogether (back to the workspaces). */
  leave: () => void;
  /** Open the main menu from the left, with the space still showing beside it. */
  openNav: () => void;
}

const noop = () => {};
export const SpaceDockContext = createContext<SpaceDock>({ docked: false, dock: noop, expand: noop, leave: noop, openNav: noop });

export const useSpaceDock = () => useContext(SpaceDockContext);
