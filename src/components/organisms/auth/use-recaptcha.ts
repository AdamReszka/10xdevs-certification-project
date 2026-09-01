"use client";

import { useCallback, useEffect, useRef } from "react";

import { CAPTCHA_HEADER } from "@/lib/captcha";

/**
 * Invisible reCAPTCHA v2 for the three unauthenticated auth forms (FR-001).
 *
 * ## What "invisible" means here, and why it needs a hook at all
 *
 * v2 Invisible renders nothing until Google is suspicious. The token is not
 * available at render time — it is produced by `grecaptcha.execute()`, which
 * resolves through a CALLBACK, and only once per token. So a form cannot read a
 * value out of the DOM on submit; it has to ask, wait, and then send. That
 * asymmetry is the entire reason this is a hook and not a hidden input.
 *
 * ## Disabled is a first-class state, not an error
 *
 * `siteKey === null` means captcha is not configured — local dev, the unit
 * suite, Playwright. {@link useRecaptcha} then returns headers with no token and
 * the server, having no secret either, never asks for one. The two sides are
 * resolved independently on purpose (`lib/captcha.ts`), and in production a
 * missing key throws there rather than degrading to this branch.
 *
 * ## One widget per mount, torn down on unmount
 *
 * `grecaptcha.render()` throws if called twice on the same container, and Next's
 * client navigation remounts these forms freely. The widget id is kept in a ref
 * and reset — not re-rendered — on each submit, because a v2 token is
 * single-use: submitting twice with one token fails the second verification with
 * an error that reads exactly like a wrong password.
 */

type Grecaptcha = {
  render: (
    container: HTMLElement,
    params: { sitekey: string; size: "invisible"; callback: (token: string) => void },
  ) => number;
  execute: (widgetId: number) => void;
  reset: (widgetId: number) => void;
  ready: (cb: () => void) => void;
};

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

const SCRIPT_ID = "recaptcha-v2-invisible";
const SCRIPT_SRC = "https://www.google.com/recaptcha/api.js?render=explicit";

/** Rejected rather than hung: a form awaiting a token that never arrives leaves
 *  the submit button spinning with nothing on screen explaining why. */
const EXECUTE_TIMEOUT_MS = 20_000;

export type RecaptchaHandle = {
  /**
   * Headers to merge into the Better Auth call. Empty when captcha is disabled.
   * Throws when a token cannot be obtained — the caller surfaces that as a
   * failed submit, which is the fail-closed behaviour the owner chose: no token
   * means no request, rather than a request the server will reject anyway.
   */
  headers: () => Promise<Record<string, string>>;
  /** True when a widget is configured — lets a form label the Google notice. */
  enabled: boolean;
};

export function useRecaptcha(siteKey: string | null): RecaptchaHandle {
  const widgetId = useRef<number | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const pending = useRef<((token: string) => void) | null>(null);

  useEffect(() => {
    if (!siteKey) return;

    // Off-screen rather than `display: none`: Google refuses to execute a widget
    // in a container it considers hidden, and the failure is silent — the
    // callback simply never fires.
    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.left = "-9999px";
    host.style.top = "0";
    document.body.appendChild(host);
    container.current = host;

    let cancelled = false;

    const renderWidget = () => {
      if (cancelled || !window.grecaptcha || !container.current) return;
      window.grecaptcha.ready(() => {
        if (cancelled || !window.grecaptcha || !container.current) return;
        widgetId.current = window.grecaptcha.render(container.current, {
          sitekey: siteKey,
          size: "invisible",
          // ONE stable callback for the widget's whole life, dispatching to
          // whichever submit is currently waiting. Re-rendering the widget per
          // submit would leak a widget per attempt.
          callback: (token: string) => {
            pending.current?.(token);
            pending.current = null;
          },
        });
      });
    };

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      renderWidget();
    } else {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = renderWidget;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      pending.current = null;
      host.remove();
      container.current = null;
      widgetId.current = null;
    };
  }, [siteKey]);

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    if (!siteKey) return {};

    const grecaptcha = window.grecaptcha;
    const id = widgetId.current;
    if (!grecaptcha || id === null) {
      throw new Error("The verification widget has not loaded yet.");
    }

    const token = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current = null;
        reject(new Error("Verification timed out."));
      }, EXECUTE_TIMEOUT_MS);

      pending.current = (value: string) => {
        clearTimeout(timer);
        resolve(value);
      };

      // Single-use: reset BEFORE executing so a second submit gets a fresh
      // token rather than replaying the first, which verifies as a failure.
      grecaptcha.reset(id);
      grecaptcha.execute(id);
    });

    return { [CAPTCHA_HEADER]: token };
  }, [siteKey]);

  return { headers, enabled: siteKey !== null };
}
