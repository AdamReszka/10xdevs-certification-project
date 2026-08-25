"use client";

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Tab shell for Dashboard "Today" (S-10, FR-016).
 *
 * The Anomaly Inbox is the default tab and the first trigger, deliberately: it
 * is the product's differentiator, and FR-016 puts everything else "one click
 * away" precisely so the other four panels cannot dilute it. S-08 added
 * Availability as the fifth, for the same reason it is not an always-on card.
 *
 * Panels arrive as ELEMENT props for the same reason as Sprint Detail's shell —
 * importing the server components here would drag their DB reads across the
 * client boundary.
 */
export default function DashboardTodayTabs({
  inbox,
  pulse,
  yesterday,
  reliability,
  availability,
}: {
  inbox: ReactNode;
  pulse: ReactNode;
  yesterday: ReactNode;
  reliability: ReactNode;
  availability: ReactNode;
}) {
  return (
    <Tabs defaultValue="inbox" className="w-full">
      <TabsList>
        <TabsTrigger value="inbox">Anomaly Inbox</TabsTrigger>
        <TabsTrigger value="pulse">Sprint Pulse</TabsTrigger>
        <TabsTrigger value="yesterday">Yesterday</TabsTrigger>
        <TabsTrigger value="reliability">Reliability</TabsTrigger>
        <TabsTrigger value="availability">Availability</TabsTrigger>
      </TabsList>
      <TabsContent value="inbox">{inbox}</TabsContent>
      <TabsContent value="pulse">{pulse}</TabsContent>
      <TabsContent value="yesterday">{yesterday}</TabsContent>
      <TabsContent value="reliability">{reliability}</TabsContent>
      <TabsContent value="availability">{availability}</TabsContent>
    </Tabs>
  );
}
