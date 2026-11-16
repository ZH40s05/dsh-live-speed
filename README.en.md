# DSH Live Speed

[简体中文](README.md) · MIT License

A zero-runtime-dependency Web plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Adds live reply characters/second, time to first token, last-step output tokens/second and session model/tool timing to the composer activity bar. Supports English/Chinese, host themes and compact mode.

## Compatibility and installation

Version **0.2.6** targets **DSH 0.2.2-rc.3**. Other host versions are unverified. Node.js 22+ is required for development tooling. This is a host-loaded plugin, not a standalone webpage.

Download the tarball from GitHub Releases and install it using your host plugin importer, if available, or:

```sh
dsh plugin add /absolute/path/dsh-live-speed-0.2.6.tgz
# For a non-default profile:
dsh plugin --profile your-profile add /absolute/path/dsh-live-speed-0.2.6.tgz
```

Reload following your host plugin lifecycle, then enable/disable in the plugin manager. The bundle patch registers the host entry; do not register it twice manually. Uninstall with `dsh plugin remove dsh-live-speed`. It replaces only `activity`, leaving native token/cache usage intact.

## Measurement

- Live text: Unicode code points (not grapheme clusters), including Markdown but excluding reasoning/tool arguments, observed by this browser over a 2.5-second rolling window. Uses a monotonic clock and linear interpolation at the boundary; hidden for intervals below 300 ms and falls to zero after a pause.
- TTFT: host step start to first token, which may be reasoning rather than visible reply text.
- Last-step throughput: provider-reported output tokens divided by host first-token-to-completion time; may include reasoning/tool arguments. Hidden when timing/usage is unavailable. Not comparable directly to characters/second.
- Session metrics: native `sessionStats` projection, not a simple arithmetic mean of step rates.

Sampling resets between steps, retries and sessions. Browser throttling, reconnection, batched delivery and joining an in-progress session affect live readings. Text received before observation is not assigned an invented rate. Detailed mode offers a statistics popover; compact mode keeps non-interactive readings. Reduced-motion preferences are respected.

## Privacy and compatibility boundaries

Reads native browser Chat/Trajectory/session statistics only. No network requests, telemetry, persistent sampling, credential access or filesystem access. The host entry is intentionally empty.

Uses the public `conversation.composer.dock` slot. Native usage popover pinning additionally relies on host DOM markers `[data-session-stats-usage]`, `[data-turn-usage-details]` and body-level dialogs; this is version-sensitive. Effects dispose listeners, observers, styles and slot registrations when disabled.

## Development

```sh
npm run check
npm test
mkdir -p release
npm pack --pack-destination release
```

No build step or dependency install is required. Source is shipped as-is. Prepack runs syntax checks and Node built-in tests. Tests use VM/DOM mocks rather than a real browser end-to-end suite. Packages allowlist only runtime files, license and documentation. See [contributing](CONTRIBUTING.md), [security](SECURITY.md) and [changelog](CHANGELOG.md).

## License

[MIT](LICENSE). The original author has confirmed ownership of the original plugin. Adapted from the original 0.1.0 implementation. This is a community plugin, not an official DeepSeek project.
