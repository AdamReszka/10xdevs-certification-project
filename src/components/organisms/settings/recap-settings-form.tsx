"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveRecapSettingsAction } from "@/app/(app)/settings/recap/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import {
  describeLastSend,
  fromTimeValue,
  sendTimeHint,
  toTimeValue,
  type LastRecapRow,
} from "./recap-settings-view";

/**
 * The `/settings/recap` form (S-11, FR-018).
 *
 * Rendering and wiring only: every judgement lives in the pure
 * `recap-settings-view.ts` sibling, because there is no component-test harness
 * in this project. Same split as `absence-editor.tsx` / `absence-calendar-view.ts`.
 *
 * After a successful save: `router.refresh()`. There is no `revalidatePath`
 * anywhere in this repo.
 */
export default function RecapSettingsForm({
  sendHour,
  sendMinute,
  enabled,
  timeZone,
  lastRecap,
  isDemo = false,
}: {
  sendHour: number;
  sendMinute: number;
  enabled: boolean;
  timeZone: string | null;
  lastRecap: LastRecapRow | null;
  /**
   * S-09: in demo the recap row is a stored preview with a terminal send status
   * — there is no schedule behind it to change, and a fictional team has no
   * inbox. The server refuses the save too.
   */
  isDemo?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [time, setTime] = useState(() => toTimeValue(sendHour, sendMinute));
  const [isEnabled, setIsEnabled] = useState(enabled);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = fromTimeValue(time);
    if (!parsed) {
      toast.error("Pick a time between 00:00 and 23:59.");
      return;
    }

    startTransition(async () => {
      const result = await saveRecapSettingsAction({
        sendHour: parsed.hour,
        sendMinute: parsed.minute,
        enabled: isEnabled,
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Daily recap settings saved.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">When the recap arrives</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1">
              <Label htmlFor="recap-enabled">Send me a daily recap</Label>
              <p className="text-sm text-muted-foreground">
                Turn this off and SprintFlow stops emailing you. The dashboard is
                unaffected.
              </p>
            </div>
            <Switch
              id="recap-enabled"
              checked={isEnabled}
              onCheckedChange={setIsEnabled}
              disabled={pending || isDemo}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="recap-time">Earliest send time</Label>
            <Input
              id="recap-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={pending || isDemo || !isEnabled}
              className="w-40"
            />
            {/* Not decoration — the 15-minute cron cannot honour a minute
                exactly, and a picker that silently rounds would be a defect. */}
            <p className="text-sm text-muted-foreground">{sendTimeHint(timeZone)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Last send</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{describeLastSend(lastRecap)}</p>
          {/* S-12 (FR-019). The archive is unreachable without a link from the
              page that owns the concept — this card is the only place the owner
              is already thinking about sends. */}
          <Link
            href="/settings/recap/history"
            className="w-fit text-sm underline-offset-4 hover:underline"
          >
            See all past recaps →
          </Link>
        </CardContent>
      </Card>

      <div>
        <Button type="submit" disabled={pending || isDemo}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {isDemo ? (
          <p className="text-sm text-muted-foreground">
            Ustawienia recapu są wyłączone w trybie demonstracyjnym — powyżej
            widzisz zapisany podgląd, który nigdy nie został wysłany.
          </p>
        ) : null}
      </div>
    </form>
  );
}
