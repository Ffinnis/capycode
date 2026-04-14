import * as Schema from "effect/Schema";
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";

const GIT_PANEL_LAYOUT_STORAGE_KEY = "capycode:git-panel-layout:v1";

const NullableFiniteSchema = Schema.NullOr(Schema.Finite);

const GitPanelLayoutStateSchema = Schema.Struct({
  repositoriesHeight: NullableFiniteSchema,
  reviewHeight: NullableFiniteSchema,
  stagedHeight: NullableFiniteSchema,
  commitFilesHeight: NullableFiniteSchema,
});

export type GitPanelLayoutState = typeof GitPanelLayoutStateSchema.Type;

const INITIAL_GIT_PANEL_LAYOUT_STATE: GitPanelLayoutState = {
  repositoriesHeight: null,
  reviewHeight: null,
  stagedHeight: null,
  commitFilesHeight: null,
};

export type GitPanelLayoutKey = keyof GitPanelLayoutState;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type ResolveNumberInput = number | ((containerHeight: number) => number);

function resolveNumber(value: ResolveNumberInput, containerHeight: number) {
  return typeof value === "function" ? value(containerHeight) : value;
}

function clampPersistedSectionHeight(input: {
  containerHeight: number;
  requestedHeight: number;
  minHeight: number;
  maxHeight: ResolveNumberInput;
  minRemainingHeight: number;
}) {
  const resolvedMaxHeight = resolveNumber(input.maxHeight, input.containerHeight);
  const maxHeight = Math.min(
    resolvedMaxHeight,
    Math.max(input.minHeight, input.containerHeight - input.minRemainingHeight),
  );
  return clamp(input.requestedHeight, input.minHeight, maxHeight);
}

export function usePersistedGitPanelLayout() {
  const [layout, setLayout] = useLocalStorage(
    GIT_PANEL_LAYOUT_STORAGE_KEY,
    INITIAL_GIT_PANEL_LAYOUT_STATE,
    GitPanelLayoutStateSchema,
  );

  const setSectionHeight = useCallback(
    (key: GitPanelLayoutKey, nextHeight: number | null) => {
      setLayout((current) => {
        if (current[key] === nextHeight) {
          return current;
        }
        return {
          ...current,
          [key]: nextHeight,
        };
      });
    },
    [setLayout],
  );

  return {
    layout,
    setSectionHeight,
  };
}

export function useMeasuredElementHeight<T extends HTMLElement>(elementRef: RefObject<T | null>) {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    const updateHeight = () => {
      setHeight(element.clientHeight);
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateHeight();
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [elementRef]);

  return height;
}

export function usePersistedVerticalSectionHeight(input: {
  containerHeight: number;
  defaultHeight: ResolveNumberInput;
  edge?: "top" | "bottom";
  key: GitPanelLayoutKey;
  layout: GitPanelLayoutState;
  minHeight: number;
  minRemainingHeight: number;
  maxHeight: ResolveNumberInput;
  resizable: boolean;
  setSectionHeight: (key: GitPanelLayoutKey, nextHeight: number | null) => void;
}) {
  const {
    containerHeight,
    defaultHeight,
    edge = "top",
    key,
    layout,
    minHeight,
    minRemainingHeight,
    maxHeight,
    resizable,
    setSectionHeight,
  } = input;
  const [height, setHeight] = useState(0);
  const heightRef = useRef(0);
  const resizeStateRef = useRef<{
    moved: boolean;
    pointerId: number;
    startHeight: number;
    startY: number;
  } | null>(null);

  const clampHeight = useCallback(
    (requestedHeight: number) =>
      clampPersistedSectionHeight({
        containerHeight,
        requestedHeight,
        minHeight,
        maxHeight,
        minRemainingHeight,
      }),
    [containerHeight, maxHeight, minHeight, minRemainingHeight],
  );

  const persistedHeight = layout[key];

  useEffect(() => {
    if (containerHeight <= 0) {
      return;
    }

    const nextHeight = clampHeight(
      persistedHeight ?? resolveNumber(defaultHeight, containerHeight),
    );

    heightRef.current = nextHeight;
    setHeight((current) => (current === nextHeight ? current : nextHeight));
  }, [clampHeight, containerHeight, defaultHeight, persistedHeight]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!resizable || event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeStateRef.current = {
        moved: false,
        pointerId: event.pointerId,
        startHeight: heightRef.current,
        startY: event.clientY,
      };
    },
    [resizable],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const delta = event.clientY - resizeState.startY;
      const nextHeight = clampHeight(
        resizeState.startHeight + (edge === "bottom" ? -delta : delta),
      );
      if (nextHeight === heightRef.current) {
        return;
      }

      resizeState.moved = true;
      heightRef.current = nextHeight;
      setHeight(nextHeight);
    },
    [clampHeight, edge],
  );

  const handlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }

      resizeStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (resizeState.moved) {
        setSectionHeight(key, heightRef.current);
      }
    },
    [key, setSectionHeight],
  );

  return {
    handlePointerCancel: handlePointerEnd,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp: handlePointerEnd,
    height,
  };
}
