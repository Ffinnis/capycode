import { ArrowLeftIcon, ExternalLinkIcon, WrapTextIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

export function FilePreviewToolbar(props: {
  filePath: string;
  wrap: boolean;
  onToggleWrap: () => void;
  onOpenInEditor: () => void;
  onBack?: () => void;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>();

  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {props.onBack ? (
          <Button variant="ghost" size="icon-xs" onClick={props.onBack} aria-label="Back to files">
            <ArrowLeftIcon className="size-3.5" />
          </Button>
        ) : null}
        <button
          type="button"
          className="truncate text-left text-sm text-muted-foreground hover:text-foreground"
          onClick={() => copyToClipboard(props.filePath, undefined)}
          title={props.filePath}
        >
          {isCopied ? "Copied path" : props.filePath}
        </button>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant={props.wrap ? "secondary" : "outline"}
          size="xs"
          onClick={props.onToggleWrap}
        >
          <WrapTextIcon className="size-3.5" />
          Wrap
        </Button>
        <Button variant="outline" size="xs" onClick={props.onOpenInEditor}>
          <ExternalLinkIcon className="size-3.5" />
          Open in Editor
        </Button>
      </div>
    </div>
  );
}
