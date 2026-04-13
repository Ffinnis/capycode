import { FileWarningIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

export function FilePreviewUnsupported(props: {
  kind: "binary" | "too_large";
  sizeBytes: number;
  onOpenInEditor: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <FileWarningIcon className="size-8 text-muted-foreground/70" />
      <div className="space-y-1">
        <h3 className="font-medium text-foreground">
          {props.kind === "too_large"
            ? "Preview unavailable for large file"
            : "Preview unavailable for binary file"}
        </h3>
        <p className="text-sm text-muted-foreground">
          {props.kind === "too_large"
            ? `This file is ${props.sizeBytes.toLocaleString()} bytes and exceeds the inline preview limit.`
            : `This file is ${props.sizeBytes.toLocaleString()} bytes and does not have a readable text preview.`}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={props.onOpenInEditor}>
        Open in Editor
      </Button>
    </div>
  );
}
