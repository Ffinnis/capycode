"use client";

import type { GitBranch } from "@capycode/contracts";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "./ui/combobox";

interface GitBranchPickerProps {
  readonly branches: ReadonlyArray<GitBranch>;
  readonly fetchNextPage: () => Promise<unknown>;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isPending: boolean;
  readonly label: string;
  readonly placeholder: string;
  readonly query: string;
  readonly selectedBranch: string | null;
  readonly onQueryChange: (value: string) => void;
  readonly onSelect: (branch: string) => void;
}

export function GitBranchPicker(input: GitBranchPickerProps) {
  const [open, setOpen] = useState(false);
  const branchListScrollElementRef = useRef<HTMLDivElement | null>(null);
  const branchStatusText = input.isPending
    ? "Loading branches..."
    : input.isFetchingNextPage
      ? "Loading more branches..."
      : input.hasNextPage
        ? `Showing ${input.branches.length} branches`
        : input.branches.length > 0
          ? `Showing ${input.branches.length} branches`
          : "";

  const maybeFetchNextBranchPage = useCallback(() => {
    if (!open || !input.hasNextPage || input.isFetchingNextPage) {
      return;
    }

    const scrollElement = branchListScrollElementRef.current;
    if (!scrollElement) {
      return;
    }

    const distanceFromBottom =
      scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
    if (distanceFromBottom > 96) {
      return;
    }

    void input.fetchNextPage().catch(() => undefined);
  }, [input, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const scrollElement = branchListScrollElementRef.current;
    if (!scrollElement) {
      return;
    }

    const handleScroll = () => {
      maybeFetchNextBranchPage();
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [maybeFetchNextBranchPage, open]);

  useEffect(() => {
    maybeFetchNextBranchPage();
  }, [input.branches.length, maybeFetchNextBranchPage]);

  const setBranchListRef = useCallback((element: HTMLDivElement | null) => {
    branchListScrollElementRef.current = (element?.parentElement as HTMLDivElement | null) ?? null;
  }, []);

  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground">{input.label}</span>
      <Combobox
        items={input.branches.map((branch) => branch.name)}
        filteredItems={input.branches.map((branch) => branch.name)}
        autoHighlight
        open={open}
        value={input.selectedBranch ?? ""}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            input.onQueryChange("");
          }
        }}
      >
        <ComboboxTrigger
          aria-label={input.label}
          className="w-full justify-between"
          render={<Button variant="outline" />}
        >
          <span
            className={cn(
              "truncate text-left",
              input.selectedBranch
                ? "font-mono text-[13px] text-foreground"
                : "text-muted-foreground",
            )}
          >
            {input.selectedBranch ?? input.placeholder}
          </span>
          <ChevronDownIcon />
        </ComboboxTrigger>
        <ComboboxPopup className="w-(--anchor-width)">
          <div className="border-b p-1">
            <ComboboxInput
              className="[&_input]:font-sans rounded-md"
              inputClassName="ring-0"
              placeholder="Search branches..."
              showTrigger={false}
              size="sm"
              value={input.query}
              onChange={(event) => input.onQueryChange(event.target.value)}
            />
          </div>
          <ComboboxEmpty>No branches found.</ComboboxEmpty>
          <ComboboxList ref={setBranchListRef} className="max-h-56">
            {input.branches.map((branch, index) => {
              const badge = branch.current
                ? "current"
                : branch.isDefault
                  ? "default"
                  : branch.isRemote
                    ? "remote"
                    : null;
              return (
                <ComboboxItem
                  hideIndicator
                  key={branch.name}
                  index={index}
                  value={branch.name}
                  onClick={() => {
                    input.onSelect(branch.name);
                    setOpen(false);
                  }}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <GitBranchIcon
                        className={cn(
                          "size-3.5 shrink-0",
                          branch.current
                            ? "text-emerald-500"
                            : branch.isDefault
                              ? "text-primary/70"
                              : "opacity-40",
                        )}
                      />
                      <span className="truncate font-mono text-[13px]">{branch.name}</span>
                    </span>
                    {badge ? (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                          badge === "current" &&
                            "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
                          badge === "default" && "bg-primary/10 text-primary",
                          badge === "remote" && "bg-muted text-muted-foreground",
                        )}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </div>
                </ComboboxItem>
              );
            })}
          </ComboboxList>
          {branchStatusText ? <ComboboxStatus>{branchStatusText}</ComboboxStatus> : null}
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}
