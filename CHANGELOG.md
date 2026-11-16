# Changelog

## 0.2.6

- First public source release under MIT with bilingual installation, privacy and measurement documentation.
- Add Node built-in regression tests and CI, package allowlist and prepack validation.
- Keep an initial sampling baseline so the first observed reply increment participates in the rate; interpolate rolling-window boundaries for a smoothed estimate. Existing text when joining a stream is excluded from the observed rate.
- Memoize Unicode counting across timer-only rerenders. Each incoming text snapshot still requires a full code-point count.
- Preserve native step-level TTFT during retries; no per-attempt TTFT is inferred.
- Move focus into the statistics popover on open, restore it on Escape/close, and respect reduced-motion preferences.

## 0.2.5

- Internal version adapted for DSH 0.2.2-rc.3: live reply character rate, native token throughput, compact mode and native usage-dialog pinning.
