// quiet-hours.mjs: the owner's quiet hours. During them, no agent works unless the owner approves each instance.
//
//   node tools/quiet-hours.mjs status    prints whether now is inside the quiet hours
//   node tools/quiet-hours.mjs check     exit 1 inside the quiet hours, unless QUIET_HOURS_APPROVED=1 is set
//
// The hours are personal, so they live in a git-ignored file: .local/quiet-hours.json. Without that file, nothing
// is quiet. An invalid file counts as quiet (fail closed). The messages never print the time zone or the hours, so
// an agent cannot copy them into a public file. Format (an example, not anyone's real hours):
//   { "timeZone": "UTC", "days": ["Mon", "Tue", "Wed", "Thu", "Fri"], "start": "09:00", "end": "17:00" }
// timeZone is an IANA name ("Region/City" or "UTC"), so daylight-saving changes are handled. A window whose start is
// later than its end runs past midnight into the next day ("22:00" to "07:00"); "24:00" ends a window at midnight.
// Uses Node built-ins only.

import fs from "node:fs";
import path from "node:path";
import { privatePath } from "./main-checkout.mjs";

/** The file is git-ignored, so it lives in the main checkout only; a linked worktree reads it from there. */
export const configPath = () => privatePath(".local", "quiet-hours.json");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const toMinutes = (hhmm, { allow24 = false } = {}) => {
  if (allow24 && hhmm === "24:00") return 1440;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm ?? "");
  if (!m) throw new Error(`"${hhmm}" is not a time in HH:MM form`);
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Throws when the config is not valid. */
export function validate(cfg) {
  if (!cfg || typeof cfg !== "object") throw new Error("the config is not an object");
  if (typeof cfg.timeZone !== "string" || !/^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/.test(cfg.timeZone)) {
    throw new Error('timeZone must be an IANA name such as "UTC" or "Region/City"');
  }
  new Intl.DateTimeFormat("en-US", { timeZone: cfg.timeZone }); // throws on an unknown zone
  if (!Array.isArray(cfg.days) || !cfg.days.length || !cfg.days.every((d) => DAYS.includes(d))) throw new Error(`days must be a list of ${DAYS.join(", ")}`);
  const start = toMinutes(cfg.start), end = toMinutes(cfg.end, { allow24: true });
  if (start === end) throw new Error("start and end must differ");
  return cfg;
}

/** The weekday and the minutes after midnight of `date` in `timeZone`. */
export function localTime(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  return { day: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** True when `date` is inside the quiet hours of a valid config. A window past midnight belongs to its start day. */
export function inQuietHours(cfg, date = new Date()) {
  validate(cfg);
  const { day, minutes } = localTime(date, cfg.timeZone);
  const start = toMinutes(cfg.start), end = toMinutes(cfg.end, { allow24: true });
  if (start < end) return cfg.days.includes(day) && minutes >= start && minutes < end;
  const yesterday = DAYS[(DAYS.indexOf(day) + 6) % 7];
  return (cfg.days.includes(day) && minutes >= start) || (cfg.days.includes(yesterday) && minutes < end);
}

/**
 * { quiet, reason } for now. No config: not quiet. An unreadable or invalid config, or a main checkout that cannot
 * be found: quiet (fail closed).
 */
export function status(date = new Date(), file = undefined) {
  if (file === undefined) {
    try {
      file = configPath();
    } catch {
      // No error text: it holds local paths, and the reason may reach a public message.
      return { quiet: true, reason: "the main checkout could not be found; it counts as quiet until the owner fixes it" };
    }
  }
  if (!fs.existsSync(file)) return { quiet: false, reason: "no quiet hours are set" };
  let cfg;
  try {
    cfg = validate(JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")));
  } catch (e) {
    return { quiet: true, reason: `the quiet-hours file is invalid (${e.message}); it counts as quiet until the owner fixes it` };
  }
  return inQuietHours(cfg, date)
    ? { quiet: true, reason: "it is inside the owner's quiet hours" }
    : { quiet: false, reason: "it is outside the owner's quiet hours" };
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === "quiet-hours.mjs";
if (isMain) {
  const s = status();
  const mode = process.argv[2] ?? "status";
  if (mode === "check" && s.quiet && process.env.QUIET_HOURS_APPROVED !== "1") {
    console.error(`Stopped: ${s.reason}. No work without the owner's approval for this instance. ` +
      "If the owner approves, run the command again with QUIET_HOURS_APPROVED=1 set.");
    process.exit(1);
  }
  console.log(s.reason);
}
