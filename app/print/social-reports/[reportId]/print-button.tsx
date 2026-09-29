"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

/** The browser's own print dialog, which also saves as PDF. */
export function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      <Printer size={14} aria-hidden="true" />
      Print or save as PDF
    </Button>
  );
}
