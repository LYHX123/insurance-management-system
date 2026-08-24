import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnreadDot } from "@/components/ui/unread-dot";

// Task/Claim User-Level Unread Indicator, Part B6 — a small dot only, never
// a badge/count/"Unread" text/toast, and rendered only when actually unread.
describe("UnreadDot", () => {
  it("renders nothing when show is false", () => {
    render(<UnreadDot show={false} />);
    expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument();
  });

  it("renders a small red dot when show is true", () => {
    render(<UnreadDot show={true} />);
    const dot = screen.getByLabelText("Unread");
    expect(dot).toBeInTheDocument();
    expect(dot.className).toMatch(/rounded-full/);
    expect(dot.className).toMatch(/bg-red-500/);
  });
});
