// `npm run deploy` used to run:
//
//     npx wrangler pages deploy dist --project-name=lumoscore-xrpl --branch=main --commit-dirty=true
//
// That command was wrong in four ways by the time it was removed, and dangerous in one.
//
//   1. THE PROJECT DOES NOT EXIST. The account holds `lumoscore`, `lumoscore-staging` and
//      `lumoscore-admin`, and nothing else. Wrangler's response to an unknown project name is to
//      OFFER TO CREATE IT -- so the failure mode was not an error, it was a brand new public site
//      serving a half-built XRPL tree under a name nobody was watching.
//   2. IT SHIPPED THE WRONG LAYOUT. `npm run build` passes `--root`, which lays the site out at the
//      root of `dist/` for local browsing. The tree the combine consumes is the NON-root one at
//      `dist/xrpl/`. See `npm run build:deploy`.
//   3. `--branch=main` MAKES IT A PRODUCTION DEPLOYMENT, not a preview.
//   4. XRPL DOES NOT SHIP ON ITS OWN. It reaches production only inside the combined tree, which is
//      assembled in the deploy repository from this build plus Stellar's.
//
// This script exists instead of deleting the entry, because `npm run deploy` is what hands reach for
// and `Missing script: deploy` does not tell anyone what to do next.

const L = [
  '',
  '  npm run deploy does not exist for this repository, on purpose.',
  '',
  '  XRPL never ships on its own. There is no lumoscore-xrpl Pages project, and a wrangler',
  '  deploy naming one would CREATE a stray public site rather than fail.',
  '',
  '  The build that actually ships:',
  '',
  '      npm run build:deploy        # non-root -> dist/xrpl/   (this is the one the combine reads)',
  '      npm run check               # the predeploy gate, run it before handing the build over',
  '',
  '  Production is then assembled and uploaded from the DEPLOY repository, which merges this',
  '  build with Stellar\'s. That step does not live here and is not run from here.',
  '',
  '  For local browsing instead, `npm run build` (--root) followed by `npm run serve` is correct;',
  '  just never hand a --root build to the combine.',
  '',
];

console.error(L.join('\n'));
process.exit(1);
