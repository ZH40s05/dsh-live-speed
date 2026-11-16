# Contributing

Use Node.js 22+ and run `npm run check`, `npm test`, then `npm pack --dry-run`. There are no runtime or development dependencies to install. Keep the browser entry compatible with the DSH module loader; React and ReactDOM are provided by the host.

Please include a regression test for metric or lifecycle changes, explain counting/timing semantics, and test affected interactions in DSH 0.2.2-rc.3. VM mocks do not replace host browser testing. Avoid committing real conversations, credentials, local paths, host configuration, generated tarballs or node_modules.

Contributions are licensed under MIT. This project does not claim compatibility with untested host versions.
