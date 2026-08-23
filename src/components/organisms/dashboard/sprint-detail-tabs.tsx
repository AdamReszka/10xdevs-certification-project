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
}: {
  aging: ReactNode;
  matrix: ReactNode;
  burndown: ReactNode;
}) {
  return (
    <Tabs defaultValue="aging" className="w-full">
      <TabsList>
        <TabsTrigger value="aging">Workflow health</TabsTrigger>
        <TabsTrigger value="matrix">Team activity</TabsTrigger>
        <TabsTrigger value="burndown">By technology</TabsTrigger>
      </TabsList>
      <TabsContent value="aging">{aging}</TabsContent>
      <TabsContent value="matrix">{matrix}</TabsContent>
      <TabsContent value="burndown">{burndown}</TabsContent>
    </Tabs>
  );
}
