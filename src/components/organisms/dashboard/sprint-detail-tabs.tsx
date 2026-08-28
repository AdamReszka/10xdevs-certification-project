"use client";

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Tab shell for Sprint Detail (S-10).
 *
 * Panels arrive as ELEMENT props, not as imports. Radix `Tabs` is client-only,
 * but the panels are server components that read the database — importing them
 * here would pull the whole panel tree across the client boundary and break
 * those reads. Passing rendered elements keeps the boundary at this component.
 */
export default function SprintDetailTabs({
  aging,
  matrix,
  burndown,
  notice,
}: {
  aging: ReactNode;
  matrix: ReactNode;
  burndown: ReactNode;
  /**
   * Replaces all three panels when the selected sprint has a measurement record
   * but no raw data left (S-23 Phase 7).
   *
   * It takes over every panel rather than sitting above them, because the three
   * reducers would otherwise render their ordinary "nothing here" empty states —
   * and an empty aging report is indistinguishable from a sprint in which
   * nothing aged. The tab chrome stays so the reader can see WHICH three things
   * are missing.
   */
  notice?: ReactNode;
}) {
  return (
    <Tabs defaultValue="aging" className="w-full">
      <TabsList>
        <TabsTrigger value="aging">Workflow health</TabsTrigger>
        <TabsTrigger value="matrix">Team activity</TabsTrigger>
        <TabsTrigger value="burndown">By technology</TabsTrigger>
      </TabsList>
      <TabsContent value="aging">{notice ?? aging}</TabsContent>
      <TabsContent value="matrix">{notice ?? matrix}</TabsContent>
      <TabsContent value="burndown">{notice ?? burndown}</TabsContent>
    </Tabs>
  );
}
